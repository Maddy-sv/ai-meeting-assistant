import { planTaskProgressUpdates } from "@/lib/continuous-memory";
import { transcriptText } from "@/server/ai/prompts";
import { fail, jsonStrings, type Client } from "@/server/meetings";

const TRANSCRIPT_PAGE = 1000;
const LOAD_BATCH = 5;

export interface TaskProgressResult {
  updated: number;
  done: number;
  in_progress: number;
}

type MeetingInfo = {
  id: string;
  project_id: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  created_at: string;
};

async function loadMeetingProgress(supabase: Client, meetingId: string) {
  const segments: Array<{ speaker: string; content: string }> = [];
  for (let from = 0; ; from += TRANSCRIPT_PAGE) {
    const { data, error } = await supabase
      .from("transcripts")
      .select("speaker, content")
      .eq("meeting_id", meetingId)
      .order("segment_index", { ascending: true })
      .range(from, from + TRANSCRIPT_PAGE - 1);
    if (error) fail("load transcript", error, "Could not load a meeting transcript.");
    segments.push(...(data ?? []));
    if (!data || data.length < TRANSCRIPT_PAGE) break;
  }

  const [summaryRes, tasksRes, participantsRes] = await Promise.all([
    supabase
      .from("ai_summaries")
      .select("executive_summary, key_points")
      .eq("meeting_id", meetingId)
      .maybeSingle(),
    supabase
      .from("action_items")
      .select("id, meeting_id, title, status, canonical_key")
      .eq("meeting_id", meetingId),
    supabase.from("participants").select("name").eq("meeting_id", meetingId),
  ]);
  if (summaryRes.error) fail("load summary", summaryRes.error, "Could not load a meeting summary.");
  if (tasksRes.error) fail("load tasks", tasksRes.error, "Could not load the meeting's tasks.");
  if (participantsRes.error) {
    fail("load participants", participantsRes.error, "Could not load the meeting participants.");
  }

  const text = [
    transcriptText(segments),
    summaryRes.data?.executive_summary ?? "",
    ...jsonStrings(summaryRes.data?.key_points),
  ].join("\n");
  return {
    text,
    tasks: tasksRes.data ?? [],
    names: (participantsRes.data ?? []).map((p) => p.name.trim()).filter(Boolean),
  };
}

async function applyStatus(
  supabase: Client,
  ids: string[],
  status: "in_progress" | "done",
): Promise<number> {
  let count = 0;
  for (let i = 0; i < ids.length; i += 100) {
    let query = supabase
      .from("action_items")
      .update({ status })
      .in("id", ids.slice(i, i + 100))
      .neq("status", "done");
    if (status === "in_progress") query = query.neq("status", "in_progress");
    const { data, error } = await query.select("id");
    if (error) fail("update task progress", error, "Could not update task progress.");
    count += data?.length ?? 0;
  }
  return count;
}

function meetingDate(m: MeetingInfo): string {
  return m.started_at ?? m.scheduled_at ?? m.created_at;
}

export async function reconcileTaskProgress(
  supabase: Client,
  userId: string,
  scope: { meetingId?: string } = {},
): Promise<TaskProgressResult> {
  let query = supabase
    .from("meetings")
    .select("id, project_id, scheduled_at, started_at, created_at")
    .eq("host_id", userId);

  if (scope.meetingId) {
    const { data: target, error } = await supabase
      .from("meetings")
      .select("project_id")
      .eq("id", scope.meetingId)
      .eq("host_id", userId)
      .maybeSingle();
    if (error) fail("load meeting", error, "Could not load the meeting.");
    if (!target) return { updated: 0, done: 0, in_progress: 0 };
    query = target.project_id
      ? query.eq("project_id", target.project_id)
      : query.is("project_id", null);
  }

  const { data: meetingRows, error } = await query;
  if (error) fail("load meetings", error, "Could not load your meetings.");
  if (!meetingRows || meetingRows.length < 2) return { updated: 0, done: 0, in_progress: 0 };

  const records = new Map<string, Awaited<ReturnType<typeof loadMeetingProgress>>>();
  for (let i = 0; i < meetingRows.length; i += LOAD_BATCH) {
    const batch = meetingRows.slice(i, i + LOAD_BATCH);
    const loaded = await Promise.all(batch.map((m) => loadMeetingProgress(supabase, m.id)));
    batch.forEach((m, j) => records.set(m.id, loaded[j]));
  }

  const groups = new Map<string, MeetingInfo[]>();
  for (const m of meetingRows) {
    const key = m.project_id ?? "";
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }

  const doneIds: string[] = [];
  const progressIds: string[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const loaded = group.map((meeting) => ({ meeting, record: records.get(meeting.id) }));
    const names = Array.from(new Set(loaded.flatMap(({ record }) => record?.names ?? [])));
    const updates = planTaskProgressUpdates(
      loaded.map(({ meeting, record }) => ({
        id: meeting.id,
        date: meetingDate(meeting),
        text: record?.text ?? "",
      })),
      loaded.flatMap(({ record }) => record?.tasks ?? []),
      names,
    );
    for (const u of updates) {
      if (u.status === "done") doneIds.push(u.id);
      else if (u.status === "in_progress") progressIds.push(u.id);
    }
  }

  const done = await applyStatus(supabase, doneIds, "done");
  const in_progress = await applyStatus(supabase, progressIds, "in_progress");
  return { updated: done + in_progress, done, in_progress };
}

export async function reconcileAfterMeeting(
  supabase: Client,
  userId: string,
  meetingId: string,
): Promise<TaskProgressResult | null> {
  try {
    return await reconcileTaskProgress(supabase, userId, { meetingId });
  } catch (err) {
    console.error(
      "[tasks] cross-meeting progress after meeting:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
