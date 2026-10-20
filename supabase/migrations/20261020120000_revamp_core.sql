-- =============================================================================
-- Revamp core migration
--
-- * is_admin() replaces direct has_role() calls in every policy.
-- * Admins can READ across users (table policies) but only change other users'
--   data through the SECURITY DEFINER admin_* RPCs below.
-- * profiles: is_active, email, protection of subscription_plan / is_active.
-- * meetings: google_event_id, reminder_sent_at, project ownership check.
-- * action_items: assignee_user_id, canonical_key, updated_at, status check,
--   assignee-based RLS (replaces the old ILIKE policies).
-- * notifications.link, chat_messages, ai_usage.
-- * Admin RPCs, search_workspace().
--
-- Written to be re-runnable where practical (IF NOT EXISTS, DROP ... IF EXISTS,
-- CREATE OR REPLACE).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. is_admin()
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Rewrite every policy that called has_role(auth.uid(), 'admin').
--    Owners keep full access; admins get read-only access across users.
-- -----------------------------------------------------------------------------

-- user_roles
DROP POLICY IF EXISTS "users read own roles" ON public.user_roles;
CREATE POLICY "users read own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());

-- profiles
DROP POLICY IF EXISTS "read own profile or admin" ON public.profiles;
CREATE POLICY "read own profile or admin" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.is_admin());

DROP POLICY IF EXISTS "update own profile" ON public.profiles;
CREATE POLICY "update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- meetings
DROP POLICY IF EXISTS "manage own meetings" ON public.meetings;
CREATE POLICY "manage own meetings" ON public.meetings
  FOR ALL TO authenticated
  USING (auth.uid() = host_id)
  WITH CHECK (auth.uid() = host_id);

DROP POLICY IF EXISTS "admins read all meetings" ON public.meetings;
CREATE POLICY "admins read all meetings" ON public.meetings
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- participants
DROP POLICY IF EXISTS "participants via meeting" ON public.participants;
CREATE POLICY "participants via meeting" ON public.participants
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_id AND m.host_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_id AND m.host_id = auth.uid()));

DROP POLICY IF EXISTS "admins read all participants" ON public.participants;
CREATE POLICY "admins read all participants" ON public.participants
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- transcripts
DROP POLICY IF EXISTS "transcripts via meeting" ON public.transcripts;
CREATE POLICY "transcripts via meeting" ON public.transcripts
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_id AND m.host_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_id AND m.host_id = auth.uid()));

DROP POLICY IF EXISTS "admins read all transcripts" ON public.transcripts;
CREATE POLICY "admins read all transcripts" ON public.transcripts
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- ai_summaries
DROP POLICY IF EXISTS "summaries via meeting" ON public.ai_summaries;
CREATE POLICY "summaries via meeting" ON public.ai_summaries
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_id AND m.host_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_id AND m.host_id = auth.uid()));

DROP POLICY IF EXISTS "admins read all summaries" ON public.ai_summaries;
CREATE POLICY "admins read all summaries" ON public.ai_summaries
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- action_items (host policy; assignee policies are added in section 5)
-- Remove a hand-added catch-all policy found on the live project: it matched assignees with
-- ILIKE '%name%' and called has_role, so it would both leak tasks and break once has_role is revoked.
DROP POLICY IF EXISTS "action_items_master_policy" ON public.action_items;
DROP POLICY IF EXISTS "actions via meeting" ON public.action_items;
CREATE POLICY "actions via meeting" ON public.action_items
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_id AND m.host_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_id AND m.host_id = auth.uid()));

DROP POLICY IF EXISTS "admins read all actions" ON public.action_items;
CREATE POLICY "admins read all actions" ON public.action_items
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- decisions
DROP POLICY IF EXISTS "decisions via meeting" ON public.decisions;
CREATE POLICY "decisions via meeting" ON public.decisions
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_id AND m.host_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_id AND m.host_id = auth.uid()));

DROP POLICY IF EXISTS "admins read all decisions" ON public.decisions;
CREATE POLICY "admins read all decisions" ON public.decisions
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- has_role() is no longer referenced by any policy; stop exposing it.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;

-- -----------------------------------------------------------------------------
-- 3. profiles: is_active, email, protected columns
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url, email)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    NEW.raw_user_meta_data->>'avatar_url',
    NEW.email
  )
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user') ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Keep profiles.email in sync when the auth email changes.
CREATE OR REPLACE FUNCTION public.handle_user_email_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.profiles SET email = NEW.email WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.handle_user_email_change() FROM PUBLIC, anon, authenticated;

-- Create the trigger only if it is missing: on hosted Supabase the migration
-- role may not own auth.users, so a DROP TRIGGER there would fail on re-runs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'on_auth_user_email_changed'
      AND tgrelid = 'auth.users'::regclass
  ) THEN
    CREATE TRIGGER on_auth_user_email_changed
    AFTER UPDATE OF email ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_user_email_change();
  END IF;
END;
$$;

-- Backfill: profiles for users created before the trigger existed, then emails.
INSERT INTO public.profiles (id, full_name, email)
SELECT u.id,
       COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
       u.email
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);

UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE u.id = p.id AND p.email IS DISTINCT FROM u.email;

-- Users may not change their own plan, active flag or email. Changes are
-- allowed when they come from a SECURITY DEFINER function / service role
-- (current_user is not a client role) or from an admin.
CREATE OR REPLACE FUNCTION public.protect_profile_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.subscription_plan := 'free';
    NEW.is_active := true;
    NEW.email := auth.jwt() ->> 'email';
    RETURN NEW;
  END IF;

  IF NEW.subscription_plan IS DISTINCT FROM OLD.subscription_plan THEN
    RAISE EXCEPTION 'You cannot change your subscription plan.';
  END IF;
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'You cannot change your account status.';
  END IF;
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'Email is managed by your login account.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.protect_profile_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_protect_columns ON public.profiles;
CREATE TRIGGER profiles_protect_columns
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_columns();

-- -----------------------------------------------------------------------------
-- 4. meetings: new columns, project ownership
-- -----------------------------------------------------------------------------
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS google_event_id text;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS meetings_host_id_idx ON public.meetings (host_id);
CREATE INDEX IF NOT EXISTS meetings_project_id_idx ON public.meetings (project_id);
CREATE INDEX IF NOT EXISTS meetings_reminder_due_idx
  ON public.meetings (scheduled_at)
  WHERE reminder_sent_at IS NULL;

CREATE OR REPLACE FUNCTION public.check_meeting_project_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = NEW.project_id AND p.owner_id = NEW.host_id
  ) THEN
    RAISE EXCEPTION 'Project not found.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.check_meeting_project_owner() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS meetings_project_owner ON public.meetings;
CREATE TRIGGER meetings_project_owner
BEFORE INSERT OR UPDATE OF project_id, host_id ON public.meetings
FOR EACH ROW EXECUTE FUNCTION public.check_meeting_project_owner();

-- -----------------------------------------------------------------------------
-- 5. action_items
-- -----------------------------------------------------------------------------
ALTER TABLE public.action_items
  ADD COLUMN IF NOT EXISTS assignee_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL;
ALTER TABLE public.action_items ADD COLUMN IF NOT EXISTS canonical_key text;
ALTER TABLE public.action_items ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Normalise legacy status values before adding the check constraint.
UPDATE public.action_items SET status = 'done'
  WHERE lower(trim(status)) IN ('done', 'completed', 'complete') AND status <> 'done';
UPDATE public.action_items SET status = 'in_progress'
  WHERE lower(trim(status)) IN ('in_progress', 'in-progress', 'in progress') AND status <> 'in_progress';
UPDATE public.action_items SET status = 'pending'
  WHERE status NOT IN ('pending', 'in_progress', 'done');

ALTER TABLE public.action_items DROP CONSTRAINT IF EXISTS action_items_status_check;
ALTER TABLE public.action_items
  ADD CONSTRAINT action_items_status_check CHECK (status IN ('pending', 'in_progress', 'done'));

-- A plain (non-partial) unique index: NULL canonical keys never conflict, so
-- this behaves like "WHERE canonical_key IS NOT NULL" while still letting
-- PostgREST upserts use ON CONFLICT (meeting_id, canonical_key).
DROP INDEX IF EXISTS public.action_items_meeting_canonical_key_idx;
CREATE UNIQUE INDEX IF NOT EXISTS action_items_meeting_canonical_key_key
  ON public.action_items (meeting_id, canonical_key);

CREATE INDEX IF NOT EXISTS action_items_assignee_user_id_idx ON public.action_items (assignee_user_id);
CREATE INDEX IF NOT EXISTS action_items_meeting_id_idx ON public.action_items (meeting_id);

DROP TRIGGER IF EXISTS action_items_updated ON public.action_items;
CREATE TRIGGER action_items_updated
BEFORE UPDATE ON public.action_items
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Replace the wildcard ILIKE policies.
DROP POLICY IF EXISTS "users can see their assigned actions" ON public.action_items;
DROP POLICY IF EXISTS "users can update their assigned actions" ON public.action_items;

DROP POLICY IF EXISTS "assignees read assigned actions" ON public.action_items;
CREATE POLICY "assignees read assigned actions" ON public.action_items
  FOR SELECT TO authenticated
  USING (assignee_user_id = auth.uid());

DROP POLICY IF EXISTS "assignees update assigned actions" ON public.action_items;
CREATE POLICY "assignees update assigned actions" ON public.action_items
  FOR UPDATE TO authenticated
  USING (assignee_user_id = auth.uid())
  WITH CHECK (assignee_user_id = auth.uid());

-- Assignees who are not the meeting host may change only `status`.
-- Runs as the caller, so the meetings lookup is subject to RLS: only the
-- host can see their own meeting.
CREATE OR REPLACE FUNCTION public.guard_action_item_assignee_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.meetings m
    WHERE m.id = OLD.meeting_id AND m.host_id = auth.uid()
  ) THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.meeting_id IS DISTINCT FROM OLD.meeting_id
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.assignee IS DISTINCT FROM OLD.assignee
     OR NEW.assignee_user_id IS DISTINCT FROM OLD.assignee_user_id
     OR NEW.deadline IS DISTINCT FROM OLD.deadline
     OR NEW.canonical_key IS DISTINCT FROM OLD.canonical_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Assignees can only change the task status.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.guard_action_item_assignee_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS action_items_a_guard_assignee ON public.action_items;
CREATE TRIGGER action_items_a_guard_assignee
BEFORE UPDATE ON public.action_items
FOR EACH ROW EXECUTE FUNCTION public.guard_action_item_assignee_update();

-- Resolve assignee_user_id for new/changed assignee text when the caller did
-- not set it. Only verifiable identities are used: the meeting host's own
-- name/email, an account email, or a participant of the same meeting whose
-- email belongs to an account.
CREATE OR REPLACE FUNCTION public.resolve_action_item_assignee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := lower(trim(coalesce(NEW.assignee, '')));
  v_host uuid;
  v_match uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.assignee IS NOT DISTINCT FROM OLD.assignee THEN
      RETURN NEW;
    END IF;
    IF NEW.assignee_user_id IS DISTINCT FROM OLD.assignee_user_id THEN
      RETURN NEW; -- explicitly set by the caller
    END IF;
    NEW.assignee_user_id := NULL;
  ELSIF NEW.assignee_user_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF v_name = '' THEN
    RETURN NEW;
  END IF;

  SELECT host_id INTO v_host FROM public.meetings WHERE id = NEW.meeting_id;

  -- 1. the host themselves
  SELECT p.id INTO v_match
  FROM public.profiles p
  WHERE p.id = v_host
    AND (lower(trim(coalesce(p.full_name, ''))) = v_name OR lower(coalesce(p.email, '')) = v_name);
  IF v_match IS NOT NULL THEN
    NEW.assignee_user_id := v_match;
    RETURN NEW;
  END IF;

  -- 2. an account email typed as the assignee
  SELECT p.id INTO v_match
  FROM public.profiles p
  WHERE lower(coalesce(p.email, '')) = v_name
  LIMIT 1;
  IF v_match IS NOT NULL THEN
    NEW.assignee_user_id := v_match;
    RETURN NEW;
  END IF;

  -- 3. a participant of this meeting (by name) whose email is an account
  SELECT (array_agg(DISTINCT p.id))[1] INTO v_match
  FROM public.participants pa
  JOIN public.profiles p ON lower(p.email) = lower(trim(pa.email))
  WHERE pa.meeting_id = NEW.meeting_id
    AND lower(trim(pa.name)) = v_name
    AND coalesce(trim(pa.email), '') <> ''
  HAVING count(DISTINCT p.id) = 1;
  IF v_match IS NOT NULL THEN
    NEW.assignee_user_id := v_match;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.resolve_action_item_assignee() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS action_items_b_resolve_assignee ON public.action_items;
CREATE TRIGGER action_items_b_resolve_assignee
BEFORE INSERT OR UPDATE ON public.action_items
FOR EACH ROW EXECUTE FUNCTION public.resolve_action_item_assignee();

-- One-off backfill: exact case-insensitive match of the free-text assignee to
-- exactly one profile (full_name or email).
WITH cand AS (
  SELECT a.id AS action_id, p.id AS user_id
  FROM public.action_items a
  JOIN public.profiles p
    ON lower(trim(a.assignee)) = lower(trim(p.full_name))
    OR lower(trim(a.assignee)) = lower(trim(p.email))
  WHERE a.assignee_user_id IS NULL
    AND coalesce(trim(a.assignee), '') <> ''
),
uniq AS (
  SELECT action_id, (array_agg(DISTINCT user_id))[1] AS user_id
  FROM cand
  GROUP BY action_id
  HAVING count(DISTINCT user_id) = 1
)
UPDATE public.action_items a
SET assignee_user_id = u.user_id
FROM uniq u
WHERE a.id = u.action_id;

-- -----------------------------------------------------------------------------
-- 6. projects: policies restricted to signed-in users
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
REVOKE ALL ON public.projects FROM anon;

DROP POLICY IF EXISTS "Users can view their own projects" ON public.projects;
CREATE POLICY "Users can view their own projects" ON public.projects
  FOR SELECT TO authenticated USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users can insert their own projects" ON public.projects;
CREATE POLICY "Users can insert their own projects" ON public.projects
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users can update their own projects" ON public.projects;
CREATE POLICY "Users can update their own projects" ON public.projects
  FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users can delete their own projects" ON public.projects;
CREATE POLICY "Users can delete their own projects" ON public.projects
  FOR DELETE TO authenticated USING (auth.uid() = owner_id);

-- -----------------------------------------------------------------------------
-- 7. notifications.link
-- -----------------------------------------------------------------------------
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS link text;
CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON public.notifications (user_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 8. chat_messages
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL CHECK (char_length(content) <= 20000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_user_created_idx
  ON public.chat_messages (user_id, created_at DESC);

GRANT SELECT, INSERT, DELETE ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own chat messages read" ON public.chat_messages;
CREATE POLICY "own chat messages read" ON public.chat_messages
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "own chat messages insert" ON public.chat_messages;
CREATE POLICY "own chat messages insert" ON public.chat_messages
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "own chat messages delete" ON public.chat_messages;
CREATE POLICY "own chat messages delete" ON public.chat_messages
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 9. ai_usage
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  fn text NOT NULL,
  model text,
  ok boolean NOT NULL DEFAULT true,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_user_created_idx ON public.ai_usage (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_created_idx ON public.ai_usage (created_at DESC);

GRANT SELECT, INSERT ON public.ai_usage TO authenticated;
GRANT ALL ON public.ai_usage TO service_role;
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own ai usage insert" ON public.ai_usage;
CREATE POLICY "own ai usage insert" ON public.ai_usage
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "own ai usage read" ON public.ai_usage;
CREATE POLICY "own ai usage read" ON public.ai_usage
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());

-- -----------------------------------------------------------------------------
-- 10. Admin RPCs (SECURITY DEFINER, raise unless is_admin())
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_overview()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today timestamptz := date_trunc('day', now());
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can do this.';
  END IF;

  RETURN json_build_object(
    'users', (SELECT count(*) FROM auth.users),
    'active_users_7d', (SELECT count(*) FROM auth.users WHERE last_sign_in_at >= now() - interval '7 days'),
    'meetings', (SELECT count(*) FROM public.meetings),
    'meetings_completed', (SELECT count(*) FROM public.meetings WHERE status = 'completed'),
    'transcripts', (SELECT count(*) FROM public.transcripts),
    'summaries', (SELECT count(*) FROM public.ai_summaries),
    'action_items', (SELECT count(*) FROM public.action_items),
    'ai_requests', (SELECT count(*) FROM public.ai_usage),
    'ai_requests_today', (SELECT count(*) FROM public.ai_usage WHERE created_at >= v_today),
    'ai_failures_today', (SELECT count(*) FROM public.ai_usage WHERE created_at >= v_today AND NOT ok)
  );
END;
$$;

DROP FUNCTION IF EXISTS public.admin_list_users();
CREATE FUNCTION public.admin_list_users()
RETURNS TABLE (
  id uuid,
  email text,
  full_name text,
  is_admin boolean,
  is_active boolean,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  meeting_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can do this.';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email::text,
    p.full_name,
    EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role = 'admin'),
    COALESCE(p.is_active, true),
    u.created_at::timestamptz,
    u.last_sign_in_at::timestamptz,
    (SELECT count(*)::integer FROM public.meetings m WHERE m.host_id = u.id)
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  ORDER BY u.created_at DESC;
END;
$$;

DROP FUNCTION IF EXISTS public.admin_list_meetings();
CREATE FUNCTION public.admin_list_meetings()
RETURNS TABLE (
  id uuid,
  title text,
  host_email text,
  host_name text,
  status text,
  scheduled_at timestamptz,
  created_at timestamptz,
  transcript_count integer,
  has_summary boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can do this.';
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.title,
    u.email::text,
    p.full_name,
    m.status,
    m.scheduled_at,
    m.created_at,
    (SELECT count(*)::integer FROM public.transcripts t WHERE t.meeting_id = m.id),
    EXISTS (SELECT 1 FROM public.ai_summaries s WHERE s.meeting_id = m.id)
  FROM public.meetings m
  LEFT JOIN auth.users u ON u.id = m.host_id
  LEFT JOIN public.profiles p ON p.id = m.host_id
  ORDER BY m.created_at DESC
  LIMIT 1000;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_role(target uuid, make_admin boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can do this.';
  END IF;
  IF target IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = target) THEN
    RAISE EXCEPTION 'User not found.';
  END IF;
  IF target = auth.uid() AND NOT make_admin THEN
    RAISE EXCEPTION 'You cannot remove your own admin role.';
  END IF;

  IF make_admin THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (target, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles WHERE user_id = target AND role = 'admin';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_active(target uuid, active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can do this.';
  END IF;
  IF target = auth.uid() AND NOT active THEN
    RAISE EXCEPTION 'You cannot disable your own account.';
  END IF;

  UPDATE public.profiles SET is_active = active WHERE id = target;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_ai_usage()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today timestamptz := date_trunc('day', now());
  v_since timestamptz := date_trunc('day', now()) - interval '13 days';
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can do this.';
  END IF;

  RETURN json_build_object(
    'total', (SELECT count(*) FROM public.ai_usage),
    'today', (SELECT count(*) FROM public.ai_usage WHERE created_at >= v_today),
    'failures_today', (SELECT count(*) FROM public.ai_usage WHERE created_at >= v_today AND NOT ok),
    'avg_duration_ms', (
      SELECT COALESCE(round(avg(duration_ms))::integer, 0)
      FROM public.ai_usage WHERE created_at >= v_since AND duration_ms IS NOT NULL
    ),
    'by_function', COALESCE((
      SELECT json_agg(json_build_object('fn', f.fn, 'count', f.cnt, 'failures', f.failures) ORDER BY f.cnt DESC)
      FROM (
        SELECT fn, count(*) AS cnt, count(*) FILTER (WHERE NOT ok) AS failures
        FROM public.ai_usage
        WHERE created_at >= v_since
        GROUP BY fn
      ) f
    ), '[]'::json),
    'daily', (
      SELECT json_agg(json_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'count', COALESCE(c.cnt, 0)) ORDER BY d.day)
      FROM generate_series(v_since, v_today, interval '1 day') AS d(day)
      LEFT JOIN (
        SELECT date_trunc('day', created_at) AS day, count(*) AS cnt
        FROM public.ai_usage
        WHERE created_at >= v_since
        GROUP BY 1
      ) c ON c.day = d.day
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_overview() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_meetings() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_role(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_active(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_ai_usage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_meetings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_active(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ai_usage() TO authenticated;

-- -----------------------------------------------------------------------------
-- 11. search_workspace(q) — SECURITY INVOKER, RLS applies. Results are also
--     limited to the caller's own meetings (and tasks assigned to them), so an
--     admin's read access does not leak other users' data into search.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.search_workspace(text);
CREATE FUNCTION public.search_workspace(q text)
RETURNS TABLE (
  kind text,
  meeting_id uuid,
  meeting_title text,
  snippet text,
  occurred_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_q text := left(trim(coalesce(q, '')), 200);
  v_pattern text;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR char_length(v_q) < 2 THEN
    RETURN;
  END IF;

  v_pattern := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  RETURN QUERY
  SELECT r.kind, r.meeting_id, r.meeting_title, r.snippet, r.occurred_at
  FROM (
    (SELECT 'meeting'::text AS kind, m.id AS meeting_id, m.title AS meeting_title,
            m.title AS snippet, COALESCE(m.scheduled_at, m.created_at) AS occurred_at
     FROM public.meetings m
     WHERE m.host_id = v_uid AND m.title ILIKE v_pattern ESCAPE '\'
     LIMIT 50)
    UNION ALL
    (SELECT 'transcript'::text, m.id, m.title,
            substr(t.content, greatest(strpos(lower(t.content), lower(v_q)) - 60, 1), 200),
            t.spoken_at
     FROM public.transcripts t
     JOIN public.meetings m ON m.id = t.meeting_id
     WHERE m.host_id = v_uid AND t.content ILIKE v_pattern ESCAPE '\'
     LIMIT 50)
    UNION ALL
    (SELECT 'summary'::text, m.id, m.title,
            substr(s.executive_summary, greatest(strpos(lower(s.executive_summary), lower(v_q)) - 60, 1), 200),
            s.created_at
     FROM public.ai_summaries s
     JOIN public.meetings m ON m.id = s.meeting_id
     WHERE m.host_id = v_uid AND s.executive_summary ILIKE v_pattern ESCAPE '\'
     LIMIT 50)
    UNION ALL
    (SELECT 'task'::text, a.meeting_id, m.title, a.title, a.created_at
     FROM public.action_items a
     LEFT JOIN public.meetings m ON m.id = a.meeting_id
     WHERE (m.host_id = v_uid OR a.assignee_user_id = v_uid)
       AND a.title ILIKE v_pattern ESCAPE '\'
     LIMIT 50)
    UNION ALL
    (SELECT 'decision'::text, m.id, m.title, d.description, d.created_at
     FROM public.decisions d
     JOIN public.meetings m ON m.id = d.meeting_id
     WHERE m.host_id = v_uid AND d.description ILIKE v_pattern ESCAPE '\'
     LIMIT 50)
  ) r
  ORDER BY r.occurred_at DESC NULLS LAST
  LIMIT 50;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.search_workspace(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_workspace(text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 13. Realtime: publish notifications, action_items and chat_messages changes
--     (RLS still applies to what each subscriber receives).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'Publication supabase_realtime not found; skipping realtime setup.';
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY['notifications', 'action_items', 'chat_messages'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END;
$$;
