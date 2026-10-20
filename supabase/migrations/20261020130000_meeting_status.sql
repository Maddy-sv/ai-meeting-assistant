-- =============================================================================
-- Meeting status, disabled users and task counts
--
-- * meetings.status: one canonical value for a running meeting ('live').
--   Legacy 'in_progress' rows become 'live', unknown values become
--   'upcoming', then a CHECK constraint keeps it that way.
-- * is_active_user(): disabled accounts keep read access to their own data
--   but can no longer insert, update or delete anything.
-- * my_open_task_count(): open tasks the caller hosts or is assigned, counted
--   in the database instead of sending every meeting id in the URL.
--
-- Re-runnable (IF EXISTS / CREATE OR REPLACE / guarded constraint).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. meetings.status
-- -----------------------------------------------------------------------------
UPDATE public.meetings SET status = 'live'
  WHERE lower(trim(status)) IN ('in_progress', 'in-progress', 'in progress', 'live')
    AND status <> 'live';
UPDATE public.meetings SET status = 'completed'
  WHERE lower(trim(status)) IN ('completed', 'complete', 'done', 'ended')
    AND status <> 'completed';
UPDATE public.meetings SET status = 'upcoming'
  WHERE status NOT IN ('upcoming', 'live', 'completed');

ALTER TABLE public.meetings DROP CONSTRAINT IF EXISTS meetings_status_check;
ALTER TABLE public.meetings
  ADD CONSTRAINT meetings_status_check CHECK (status IN ('upcoming', 'live', 'completed'));

-- -----------------------------------------------------------------------------
-- 2. is_active_user()
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT is_active FROM public.profiles WHERE id = auth.uid()), true);
$$;

REVOKE EXECUTE ON FUNCTION public.is_active_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Owner policies: reads stay as before; writes also need an active account.
--    The FOR ALL policies from 20261020120000_revamp_core.sql are split into
--    one SELECT policy and INSERT / UPDATE / DELETE policies.
-- -----------------------------------------------------------------------------

-- meetings
DROP POLICY IF EXISTS "manage own meetings" ON public.meetings;
DROP POLICY IF EXISTS "read own meetings" ON public.meetings;
DROP POLICY IF EXISTS "insert own meetings" ON public.meetings;
DROP POLICY IF EXISTS "update own meetings" ON public.meetings;
DROP POLICY IF EXISTS "delete own meetings" ON public.meetings;
CREATE POLICY "read own meetings" ON public.meetings
  FOR SELECT TO authenticated
  USING (auth.uid() = host_id);
CREATE POLICY "insert own meetings" ON public.meetings
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = host_id AND public.is_active_user());
CREATE POLICY "update own meetings" ON public.meetings
  FOR UPDATE TO authenticated
  USING (auth.uid() = host_id AND public.is_active_user())
  WITH CHECK (auth.uid() = host_id AND public.is_active_user());
CREATE POLICY "delete own meetings" ON public.meetings
  FOR DELETE TO authenticated
  USING (auth.uid() = host_id AND public.is_active_user());

-- Tables whose rows belong to a meeting: participants, transcripts,
-- ai_summaries, action_items, decisions.
DO $$
DECLARE
  r record;
  owner_check constant text :=
    'EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_id AND m.host_id = auth.uid())';
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('participants', 'participants via meeting', 'participants'),
      ('transcripts', 'transcripts via meeting', 'transcripts'),
      ('ai_summaries', 'summaries via meeting', 'summaries'),
      ('action_items', 'actions via meeting', 'actions'),
      ('decisions', 'decisions via meeting', 'decisions')
    ) AS v(tbl, old_name, label)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.old_name, r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'read own ' || r.label, r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'insert own ' || r.label, r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'update own ' || r.label, r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'delete own ' || r.label, r.tbl);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)',
      'read own ' || r.label, r.tbl, owner_check);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s AND public.is_active_user())',
      'insert own ' || r.label, r.tbl, owner_check);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s AND public.is_active_user()) WITH CHECK (%s AND public.is_active_user())',
      'update own ' || r.label, r.tbl, owner_check, owner_check);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s AND public.is_active_user())',
      'delete own ' || r.label, r.tbl, owner_check);
  END LOOP;
END;
$$;

-- action_items: assignees may update status only while their account is active.
DROP POLICY IF EXISTS "assignees update assigned actions" ON public.action_items;
CREATE POLICY "assignees update assigned actions" ON public.action_items
  FOR UPDATE TO authenticated
  USING (assignee_user_id = auth.uid() AND public.is_active_user())
  WITH CHECK (assignee_user_id = auth.uid() AND public.is_active_user());

-- projects
DROP POLICY IF EXISTS "Users can insert their own projects" ON public.projects;
CREATE POLICY "Users can insert their own projects" ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id AND public.is_active_user());

DROP POLICY IF EXISTS "Users can update their own projects" ON public.projects;
CREATE POLICY "Users can update their own projects" ON public.projects
  FOR UPDATE TO authenticated
  USING (auth.uid() = owner_id AND public.is_active_user())
  WITH CHECK (auth.uid() = owner_id AND public.is_active_user());

DROP POLICY IF EXISTS "Users can delete their own projects" ON public.projects;
CREATE POLICY "Users can delete their own projects" ON public.projects
  FOR DELETE TO authenticated
  USING (auth.uid() = owner_id AND public.is_active_user());

-- chat_messages
DROP POLICY IF EXISTS "own chat messages insert" ON public.chat_messages;
CREATE POLICY "own chat messages insert" ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_active_user());

DROP POLICY IF EXISTS "own chat messages delete" ON public.chat_messages;
CREATE POLICY "own chat messages delete" ON public.chat_messages
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND public.is_active_user());

-- notifications (the original FOR ALL policy is split the same way)
DROP POLICY IF EXISTS "own notifications" ON public.notifications;
DROP POLICY IF EXISTS "read own notifications" ON public.notifications;
DROP POLICY IF EXISTS "insert own notifications" ON public.notifications;
DROP POLICY IF EXISTS "update own notifications" ON public.notifications;
DROP POLICY IF EXISTS "delete own notifications" ON public.notifications;
CREATE POLICY "read own notifications" ON public.notifications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "insert own notifications" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.is_active_user());
CREATE POLICY "update own notifications" ON public.notifications
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.is_active_user())
  WITH CHECK (auth.uid() = user_id AND public.is_active_user());
CREATE POLICY "delete own notifications" ON public.notifications
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.is_active_user());

-- -----------------------------------------------------------------------------
-- 4. my_open_task_count() — SECURITY INVOKER, so RLS still decides what counts.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_open_task_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT count(*)::integer
  FROM public.action_items a
  WHERE a.status <> 'done'
    AND (
      a.assignee_user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.meetings m
        WHERE m.id = a.meeting_id AND m.host_id = auth.uid()
      )
    );
$$;

REVOKE EXECUTE ON FUNCTION public.my_open_task_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_open_task_count() TO authenticated;
