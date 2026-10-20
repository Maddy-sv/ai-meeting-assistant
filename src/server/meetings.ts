import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/integrations/supabase/types";
import {
  canonicalTaskKey,
  confirmsCompletion,
  deduplicateDecisions,
  normalizeAssignee,
  resolveDeadlineToISODate,
} from "@/lib/continuous-memory";

type Client = SupabaseClient<Database>;
export type ActionItemRow = Tables<"action_items">;
export type DecisionRow = Tables<"decisions">;
export type MeetingRow = Tables<"meetings">;

/** Logs a database error and throws a user-friendly one. */
export function fail(context: string, error: { message: string }, userMessage: string): never {
  console.error(`[db] ${context}:`, error.message);
  throw new Error(userMessage);
}

/** Loads a meeting and checks that the caller is its host. */
export async function requireOwnedMeeting(
  supabase: Client,
  userId: string,
  meetingId: string,
): Promise<MeetingRow> {
  const { data, error } = await supabase
    .from("meetings")
    .select("*")
    .eq("id", meetingId)
    .maybeSingle();
  if (error) fail("load meeting", error, "Could not load the meeting.");
  if (!data || data.host_id !== userId) throw new Error("Meeting not found.");
  return data;
}

/** The caller's display name, taken from their profile (never from client input). */
export async function getHostName(supabase: Client, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", userId)
    .maybeSingle();
  if (error) fail("load profile", error, "Could not load your profile.");
  return data?.full_name?.trim() || data?.email?.split("@")[0] || "Host";
}

export async function getParticipantNames(supabase: Client, meetingId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("participants")
    .select("name")
    .eq("meeting_id", meetingId);
  if (error) fail("load participants", error, "Could not load the meeting participants.");
  return Array.from(new Set((data ?? []).map((p) => p.name.trim()).filter(Boolean)));
}

const SELF_REFERENCES = new Set(["you", "host", "me", "i", "myself", "organiser", "organizer"]);

export function resolveAssignee(raw: string | null | undefined, hostName: string): string | null {
  const name = normalizeAssignee(raw);
  if (!name) return null;
  return SELF_REFERENCES.has(name.toLowerCase()) ? hostName : name.slice(0, 200);
}

export interface ExtractedActionItem {
  title: string;
  assignee?: string | null;
  deadline?: string | null;
  status?: string | null;
}

/**
 * Saves AI-extracted action items for a meeting without a delete-then-insert
 * window:
 * 1. upsert on (meeting_id, canonical_key), keeping progress a user already
 *    made (in_progress/done) unless the AI says the task is done;
 * 2. then delete AI-managed rows (those with a canonical key, or legacy rows
 *    whose title maps to one of the new keys) that are no longer present.
 * Tasks added by hand (no canonical key) are left alone. If the AI returned
 * no tasks, nothing is changed.
 */
export async function saveExtractedActionItems(
  supabase: Client,
  meeting: Pick<MeetingRow, "id" | "scheduled_at" | "created_at">,
  items: ExtractedActionItem[],
  opts: { hostName: string; evidenceText?: string },
): Promise<ActionItemRow[]> {
  const { data: existing, error: exErr } = await supabase
    .from("action_items")
    .select("*")
    .eq("meeting_id", meeting.id);
  if (exErr) fail("load action items", exErr, "Could not load the meeting's tasks.");

  if (items.length === 0) return existing ?? [];

  const existingByKey = new Map<string, ActionItemRow>();
  for (const row of existing ?? []) {
    existingByKey.set(row.canonical_key || canonicalTaskKey(row.title), row);
  }

  const reference = meeting.scheduled_at || meeting.created_at;
  const rows = new Map<string, Database["public"]["Tables"]["action_items"]["Insert"]>();
  for (const item of items) {
    const title = item.title?.trim().slice(0, 500);
    if (!title) continue;
    const key = canonicalTaskKey(title);
    if (rows.has(key)) continue;

    const aiDone =
      item.status === "done" ||
      (opts.evidenceText ? confirmsCompletion(opts.evidenceText, title) : false);
    const prior = existingByKey.get(key)?.status;
    const status = aiDone
      ? "done"
      : prior === "done" || prior === "in_progress"
        ? prior
        : "pending";

    rows.set(key, {
      meeting_id: meeting.id,
      canonical_key: key,
      title,
      assignee: resolveAssignee(item.assignee, opts.hostName),
      deadline: item.deadline ? resolveDeadlineToISODate(item.deadline, reference) : null,
      status,
    });
  }
  if (rows.size === 0) return existing ?? [];

  // Legacy rows without a key that match a new key are replaced by the keyed row.
  const legacyMatches = (existing ?? []).filter(
    (r) => !r.canonical_key && rows.has(canonicalTaskKey(r.title)),
  );
  if (legacyMatches.length > 0) {
    // Their key would collide with nothing (NULL), so give the newest one the key
    // first; the upsert then updates it in place instead of creating a duplicate.
    const seen = new Set<string>();
    for (const r of legacyMatches) {
      const key = canonicalTaskKey(r.title);
      if (seen.has(key) || (existing ?? []).some((e) => e.canonical_key === key)) continue;
      seen.add(key);
      const { error } = await supabase
        .from("action_items")
        .update({ canonical_key: key })
        .eq("id", r.id);
      if (error) fail("adopt legacy task", error, "Could not update the meeting's tasks.");
    }
  }

  const { data: saved, error: upErr } = await supabase
    .from("action_items")
    .upsert(Array.from(rows.values()), { onConflict: "meeting_id,canonical_key" })
    .select("*");
  if (upErr) fail("save action items", upErr, "Could not save the extracted tasks.");

  const keep = new Set((saved ?? []).map((r) => r.id));
  const stale = (existing ?? []).filter(
    (r) => !keep.has(r.id) && (r.canonical_key !== null || rows.has(canonicalTaskKey(r.title))),
  );
  if (stale.length > 0) {
    const { error: delErr } = await supabase
      .from("action_items")
      .delete()
      .in(
        "id",
        stale.map((r) => r.id),
      );
    if (delErr) fail("remove stale tasks", delErr, "Could not remove outdated tasks.");
  }

  const { data: final, error: finErr } = await supabase
    .from("action_items")
    .select("*")
    .eq("meeting_id", meeting.id)
    .order("created_at", { ascending: true });
  if (finErr) fail("reload action items", finErr, "Could not load the meeting's tasks.");
  return final ?? [];
}

/**
 * Replaces a meeting's decisions safely: new rows are inserted first and the
 * old rows are deleted afterwards (by id). If the AI returned no decisions,
 * nothing is changed.
 */
export async function replaceDecisions(
  supabase: Client,
  meetingId: string,
  decisions: Array<{ description: string; made_by?: string | null }>,
): Promise<DecisionRow[]> {
  const { data: old, error: oldErr } = await supabase
    .from("decisions")
    .select("*")
    .eq("meeting_id", meetingId);
  if (oldErr) fail("load decisions", oldErr, "Could not load the meeting's decisions.");

  const unique = deduplicateDecisions(
    decisions
      .map((d) => ({
        description: (d.description || "").trim().slice(0, 1000),
        made_by: d.made_by?.trim().slice(0, 200) || null,
      }))
      .filter((d) => d.description),
  );
  if (unique.length === 0) return old ?? [];

  const { data: inserted, error: insErr } = await supabase
    .from("decisions")
    .insert(unique.map((d) => ({ meeting_id: meetingId, ...d })))
    .select("*");
  if (insErr) fail("insert decisions", insErr, "Could not save the decisions.");

  const oldIds = (old ?? []).map((d) => d.id);
  if (oldIds.length > 0) {
    const { error: delErr } = await supabase.from("decisions").delete().in("id", oldIds);
    if (delErr) {
      // Roll back the new rows so the meeting does not show duplicates.
      await supabase
        .from("decisions")
        .delete()
        .in(
          "id",
          (inserted ?? []).map((d) => d.id),
        );
      fail("remove old decisions", delErr, "Could not update the decisions.");
    }
  }
  return inserted ?? [];
}
