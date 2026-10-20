export type Meeting = {
  id: string;
  title: string;
  platform: string | null;
  status: string;
  scheduled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  meeting_link: string | null;
  host_id: string;
  created_at: string;
};

export type Transcript = {
  id: string;
  meeting_id: string;
  speaker: string;
  content: string;
  spoken_at: string;
  segment_index: number;
};

export type Participant = {
  id: string;
  meeting_id?: string;
  name: string;
  email: string | null;
  role: string | null;
};

export type Summary = {
  executive_summary: string | null;
  key_points: unknown;
  risks: unknown;
  follow_ups: unknown;
};

export type ActionItem = {
  id: string;
  meeting_id: string | null;
  title: string;
  assignee: string | null;
  deadline: string | null;
  status: string;
  created_at?: string;
};

export type Decision = {
  id: string;
  meeting_id?: string;
  description: string;
  made_by: string | null;
};

export type ParticipantRecap = {
  participantName: string;
  email: string | null;
  subject: string;
  body: string;
};

export type CopyFormat = "formatted" | "plain" | "markdown" | "json";
