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
  has_summary boolean,
  duration_seconds integer
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
    EXISTS (SELECT 1 FROM public.ai_summaries s WHERE s.meeting_id = m.id),
    m.duration_seconds::integer
  FROM public.meetings m
  LEFT JOIN auth.users u ON u.id = m.host_id
  LEFT JOIN public.profiles p ON p.id = m.host_id
  ORDER BY m.created_at DESC
  LIMIT 1000;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_meetings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_meetings() TO authenticated;
