
-- Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE POLICY "users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  company TEXT,
  time_zone TEXT DEFAULT 'UTC',
  language TEXT DEFAULT 'en',
  subscription_plan TEXT NOT NULL DEFAULT 'free',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own profile or admin" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- Meetings
CREATE TABLE public.meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'manual', -- google_meet, teams, manual
  meeting_link TEXT,
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INT DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'upcoming', -- upcoming, live, completed
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meetings TO authenticated;
GRANT ALL ON public.meetings TO service_role;
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manage own meetings" ON public.meetings FOR ALL TO authenticated USING (auth.uid() = host_id OR public.has_role(auth.uid(), 'admin')) WITH CHECK (auth.uid() = host_id);

-- Participants
CREATE TABLE public.participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT DEFAULT 'attendee',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.participants TO authenticated;
GRANT ALL ON public.participants TO service_role;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "participants via meeting" ON public.participants FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_id AND (m.host_id = auth.uid() OR public.has_role(auth.uid(), 'admin')))) WITH CHECK (EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_id AND m.host_id = auth.uid()));

-- Transcripts
CREATE TABLE public.transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  speaker TEXT NOT NULL,
  content TEXT NOT NULL,
  spoken_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  segment_index INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transcripts TO authenticated;
GRANT ALL ON public.transcripts TO service_role;
ALTER TABLE public.transcripts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "transcripts via meeting" ON public.transcripts FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_id AND (m.host_id = auth.uid() OR public.has_role(auth.uid(), 'admin')))) WITH CHECK (EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_id AND m.host_id = auth.uid()));

-- AI Summaries
CREATE TABLE public.ai_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL UNIQUE REFERENCES public.meetings(id) ON DELETE CASCADE,
  executive_summary TEXT,
  key_points JSONB DEFAULT '[]'::jsonb,
  risks JSONB DEFAULT '[]'::jsonb,
  follow_ups JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_summaries TO authenticated;
GRANT ALL ON public.ai_summaries TO service_role;
ALTER TABLE public.ai_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "summaries via meeting" ON public.ai_summaries FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_id AND (m.host_id = auth.uid() OR public.has_role(auth.uid(), 'admin')))) WITH CHECK (EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_id AND m.host_id = auth.uid()));

-- Action Items
CREATE TABLE public.action_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  assignee TEXT,
  deadline TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, done
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.action_items TO authenticated;
GRANT ALL ON public.action_items TO service_role;
ALTER TABLE public.action_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "actions via meeting" ON public.action_items FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_id AND (m.host_id = auth.uid() OR public.has_role(auth.uid(), 'admin')))) WITH CHECK (EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_id AND m.host_id = auth.uid()));

-- Decisions
CREATE TABLE public.decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  made_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.decisions TO authenticated;
GRANT ALL ON public.decisions TO service_role;
ALTER TABLE public.decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "decisions via meeting" ON public.decisions FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_id AND (m.host_id = auth.uid() OR public.has_role(auth.uid(), 'admin')))) WITH CHECK (EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_id AND m.host_id = auth.uid()));

-- Notifications
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own notifications" ON public.notifications FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Auto-create profile + default role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user') ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER meetings_updated BEFORE UPDATE ON public.meetings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
