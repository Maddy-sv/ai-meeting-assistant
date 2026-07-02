import { supabase } from "@/integrations/supabase/client";

const NOW = () => new Date();

export async function seedIfEmpty(userId: string) {
  const { count } = await supabase.from("meetings").select("id", { count: "exact", head: true }).eq("host_id", userId);
  if ((count ?? 0) > 0) return;

  const soon = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const meetings = [
    {
      host_id: userId, title: "Product Sync — Zeta Dashboard", platform: "google_meet",
      meeting_link: "https://meet.google.com/abc-defg-hij",
      scheduled_at: soon.toISOString(), status: "upcoming",
    },
    {
      host_id: userId, title: "Design Review — Landing v3", platform: "teams",
      meeting_link: "https://teams.microsoft.com/l/meetup",
      scheduled_at: tomorrow.toISOString(), status: "upcoming",
    },
    {
      host_id: userId, title: "Auth Refactor Planning", platform: "google_meet",
      started_at: yesterday.toISOString(),
      ended_at: new Date(yesterday.getTime() + 45 * 60000).toISOString(),
      duration_seconds: 45 * 60, status: "completed",
    },
    {
      host_id: userId, title: "Q3 Roadmap Kickoff", platform: "manual",
      started_at: lastWeek.toISOString(),
      ended_at: new Date(lastWeek.getTime() + 60 * 60000).toISOString(),
      duration_seconds: 60 * 60, status: "completed",
    },
  ];
  const { data: inserted } = await supabase.from("meetings").insert(meetings).select("*");
  if (!inserted) return;

  const completed = inserted.filter((m) => m.status === "completed");
  for (const m of completed) {
    await supabase.from("participants").insert([
      { meeting_id: m.id, name: "Anna Chen", email: "anna@zeta.ai", role: "host" },
      { meeting_id: m.id, name: "Marcus Reed", email: "marcus@zeta.ai" },
      { meeting_id: m.id, name: "Priya Shah", email: "priya@zeta.ai" },
    ]);
    await supabase.from("transcripts").insert([
      { meeting_id: m.id, speaker: "Anna Chen", content: "Let's align on scope for the next release.", segment_index: 0 },
      { meeting_id: m.id, speaker: "Marcus Reed", content: "I'll own the migration. QA can start on Wednesday.", segment_index: 1 },
      { meeting_id: m.id, speaker: "Priya Shah", content: "One risk: legacy SSO customers may need re-invitations.", segment_index: 2 },
      { meeting_id: m.id, speaker: "Anna Chen", content: "Great — let's ship by Friday. I'll send the recap.", segment_index: 3 },
    ]);
    await supabase.from("ai_summaries").insert({
      meeting_id: m.id,
      executive_summary: "Team aligned on shipping the new auth flow by Friday. Marcus owns the migration; QA starts Wednesday. Legacy SSO customers may need re-invitations.",
      key_points: ["Ship auth flow by Friday", "Marcus owns migration", "QA begins Wednesday"],
      risks: ["Legacy SSO customers may need re-invites"],
      follow_ups: ["Send recap email", "Notify SSO customers"],
    });
    await supabase.from("action_items").insert([
      { meeting_id: m.id, title: "Own auth migration", assignee: "Marcus Reed", deadline: new Date(Date.now() + 3 * 86400000).toISOString(), status: "pending" },
      { meeting_id: m.id, title: "QA plan for auth", assignee: "Priya Shah", deadline: new Date(Date.now() + 4 * 86400000).toISOString(), status: "pending" },
      { meeting_id: m.id, title: "Notify legacy SSO customers", assignee: "Anna Chen", status: "done" },
    ]);
    await supabase.from("decisions").insert([
      { meeting_id: m.id, description: "Ship new auth flow this Friday", made_by: "Anna Chen" },
      { meeting_id: m.id, description: "Use progressive rollout for SSO tenants", made_by: "Priya Shah" },
    ]);
  }

  await supabase.from("notifications").insert([
    { user_id: userId, type: "summary_ready", title: "Summary ready", body: "Auth Refactor Planning summary is ready to review." },
    { user_id: userId, type: "action_assigned", title: "New action item", body: "You were assigned: Notify legacy SSO customers." },
    { user_id: userId, type: "reminder", title: "Upcoming meeting", body: "Product Sync starts in 2 hours." },
  ]);
}

export function formatDuration(seconds: number | null | undefined) {
  const s = seconds ?? 0;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
