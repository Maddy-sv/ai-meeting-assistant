/**
 * Typed wrappers around the Postgres RPCs and the tables the pages share
 * (projects, meetings, chat history). Every helper throws a user-friendly
 * Error on failure, so callers can show `toast.error(err.message)`.
 */
import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

function friendlyRpcError(error: { message: string; code?: string }): string {
  // P0001 = RAISE EXCEPTION in our own SQL functions; those messages are written for users
  // (e.g. "You cannot remove your own admin role").
  if (error.code === "P0001") return error.message;
  if (error.code === "42501") return "You don't have permission to do that.";
  return "Something went wrong. Please try again.";
}

/** Returns an RPC's data, or throws a user-friendly error. */
function rpcData<T>(fn: string, res: { data: T; error: PostgrestError | null }): T {
  if (res.error) {
    console.error(`[rpc] ${fn} failed`, res.error);
    throw new Error(friendlyRpcError(res.error));
  }
  return res.data;
}

/* ------------------------------------------------------------------ rows */

export type ProfileRow = Tables<"profiles">;
export type NotificationRow = Tables<"notifications">;

/* ------------------------------------------------------------------ RPCs */

/** True when the signed-in user has the admin role (`public.is_admin()`). */
export async function isAdmin(): Promise<boolean> {
  return Boolean(rpcData("is_admin", await supabase.rpc("is_admin")));
}

export interface AdminOverview {
  users: number;
  active_users_7d: number;
  meetings: number;
  meetings_completed: number;
  transcripts: number;
  summaries: number;
  action_items: number;
  ai_requests: number;
  ai_requests_today: number;
  ai_failures_today: number;
}
export async function adminOverview(): Promise<AdminOverview> {
  // The function returns json; its shape is fixed by the SQL above.
  return rpcData(
    "admin_overview",
    await supabase.rpc("admin_overview"),
  ) as unknown as AdminOverview;
}

export interface AdminUser {
  id: string;
  email: string | null;
  full_name: string | null;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  meeting_count: number;
}
export async function adminListUsers(): Promise<AdminUser[]> {
  return rpcData("admin_list_users", await supabase.rpc("admin_list_users")) ?? [];
}

export interface AdminMeeting {
  id: string;
  title: string;
  host_email: string | null;
  host_name: string | null;
  status: string;
  scheduled_at: string | null;
  created_at: string;
  transcript_count: number;
  has_summary: boolean;
}
export async function adminListMeetings(): Promise<AdminMeeting[]> {
  return rpcData("admin_list_meetings", await supabase.rpc("admin_list_meetings")) ?? [];
}

export async function adminSetUserRole(target: string, makeAdmin: boolean): Promise<void> {
  rpcData(
    "admin_set_user_role",
    await supabase.rpc("admin_set_user_role", { target, make_admin: makeAdmin }),
  );
}

export async function adminSetUserActive(target: string, active: boolean): Promise<void> {
  rpcData("admin_set_user_active", await supabase.rpc("admin_set_user_active", { target, active }));
}

export interface AdminAiUsage {
  total: number;
  today: number;
  failures_today: number;
  avg_duration_ms: number | null;
  by_function: { fn: string; count: number; failures: number }[];
  daily: { day: string; count: number }[];
}
export async function adminAiUsage(): Promise<AdminAiUsage> {
  return rpcData("admin_ai_usage", await supabase.rpc("admin_ai_usage")) as unknown as AdminAiUsage;
}

export interface SeedDemoResult {
  project_id: string;
  meeting_ids: string[];
  /** False when the demo project already existed, so nothing new was added. */
  created: boolean;
}
/** Inserts the sample research-scenario workspace for the calling user only. */
export async function seedDemoWorkspace(): Promise<SeedDemoResult> {
  const res = await supabase.rpc("seed_demo_workspace");
  return rpcData("seed_demo_workspace", res) as unknown as SeedDemoResult;
}

/* --------------------------------------------------------------- search */

export type SearchResultKind = "meeting" | "transcript" | "summary" | "task" | "decision";

export interface SearchResult {
  kind: SearchResultKind;
  meeting_id: string;
  meeting_title: string;
  snippet: string;
  occurred_at: string | null;
}

/** Searches the caller's meetings, transcripts, summaries, tasks and decisions (RLS applies). */
export async function searchWorkspace(q: string): Promise<SearchResult[]> {
  const rows = rpcData("search_workspace", await supabase.rpc("search_workspace", { q })) ?? [];
  // `kind` is one of the five literals produced by the SQL function.
  return rows.map((r) => ({ ...r, kind: r.kind as SearchResultKind }));
}

/* --------------------------------------------------------------- tables */

async function runQuery<T>(
  query: PromiseLike<{ data: T; error: PostgrestError | null }>,
  failure: string,
): Promise<T> {
  const { data, error } = await query;
  if (error) {
    console.error(`[db] ${failure}`, error);
    throw new Error(error.code === "42501" ? "You don't have permission to do that." : failure);
  }
  return data;
}

/** Row-level security skips rows the caller may not change; report that instead of succeeding. */
function requireChanged(rows: { id: string }[] | null): void {
  if (!rows || rows.length === 0) {
    throw new Error("Not found, or you don't have permission to change it.");
  }
}

export type ProjectRow = Pick<
  Tables<"projects">,
  "id" | "name" | "description" | "owner_id" | "created_at"
>;

const PROJECT_COLUMNS = "id, name, description, owner_id, created_at";

/** The user's projects, newest first. */
export function listProjects(ownerId: string): Promise<ProjectRow[]> {
  return runQuery(
    supabase
      .from("projects")
      .select(PROJECT_COLUMNS)
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false }),
    "Could not load your projects.",
  ).then((r) => r ?? []);
}

/** One project, or null when it does not exist or is not visible to the caller. */
export function getProject(id: string): Promise<ProjectRow | null> {
  return runQuery(
    supabase.from("projects").select(PROJECT_COLUMNS).eq("id", id).maybeSingle(),
    "Could not load this project.",
  );
}

export function createProject(input: {
  ownerId: string;
  name: string;
  description: string | null;
}): Promise<ProjectRow> {
  return runQuery(
    supabase
      .from("projects")
      .insert({ owner_id: input.ownerId, name: input.name, description: input.description })
      .select(PROJECT_COLUMNS)
      .single(),
    "Could not create the project.",
  ).then((row) => {
    if (!row) throw new Error("Could not create the project.");
    return row;
  });
}

export function updateProject(
  id: string,
  input: { name: string; description: string | null },
): Promise<void> {
  return runQuery(
    supabase
      .from("projects")
      .update({ name: input.name, description: input.description })
      .eq("id", id)
      .select("id"),
    "Could not save the project.",
  ).then(requireChanged);
}

/** Deletes a project. Its meetings are kept (`meetings.project_id` becomes null). */
export function deleteProject(id: string): Promise<void> {
  return runQuery(
    supabase.from("projects").delete().eq("id", id).select("id"),
    "Could not delete the project.",
  ).then(requireChanged);
}

/** Meeting columns used by the list, calendar and project pages (includes `project_id`). */
export type MeetingListRow = Pick<
  Tables<"meetings">,
  | "id"
  | "title"
  | "platform"
  | "status"
  | "scheduled_at"
  | "started_at"
  | "created_at"
  | "duration_seconds"
  | "meeting_link"
  | "project_id"
  | "google_event_id"
>;

const MEETING_LIST_COLUMNS =
  "id, title, platform, status, scheduled_at, started_at, created_at, duration_seconds, meeting_link, project_id, google_event_id";

/** Meetings hosted by the user, newest first. */
export function listMyMeetings(hostId: string): Promise<MeetingListRow[]> {
  return runQuery(
    supabase
      .from("meetings")
      .select(MEETING_LIST_COLUMNS)
      .eq("host_id", hostId)
      .order("created_at", { ascending: false }),
    "Could not load your meetings.",
  ).then((r) => r ?? []);
}

/** Meetings linked to a project, latest scheduled first. */
export function listProjectMeetings(projectId: string): Promise<MeetingListRow[]> {
  return runQuery(
    supabase
      .from("meetings")
      .select(MEETING_LIST_COLUMNS)
      .eq("project_id", projectId)
      .order("scheduled_at", { ascending: false, nullsFirst: false }),
    "Could not load the project's meetings.",
  ).then((r) => r ?? []);
}

export interface NewMeeting {
  hostId: string;
  title: string;
  platform: string;
  meetingLink: string | null;
  scheduledAt: string;
  projectId: string | null;
  googleEventId?: string | null;
}

/** Inserts upcoming meetings for the user and returns the created rows. */
export function createMeetings(meetings: NewMeeting[]): Promise<MeetingListRow[]> {
  return runQuery(
    supabase
      .from("meetings")
      .insert(
        meetings.map((m) => ({
          host_id: m.hostId,
          title: m.title,
          platform: m.platform,
          meeting_link: m.meetingLink,
          scheduled_at: m.scheduledAt,
          project_id: m.projectId,
          google_event_id: m.googleEventId ?? null,
          status: "upcoming",
        })),
      )
      .select(MEETING_LIST_COLUMNS),
    meetings.length === 1 ? "Could not create the meeting." : "Could not create the meetings.",
  ).then((r) => r ?? []);
}

export interface ChatMessageRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

/** The user's chat history, oldest first. */
export function listChatMessages(userId: string): Promise<ChatMessageRow[]> {
  return runQuery(
    supabase
      .from("chat_messages")
      .select("id, role, content, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    "Could not load your chat history.",
  ).then((rows) =>
    (rows ?? []).map((m) => ({ ...m, role: m.role === "assistant" ? "assistant" : "user" })),
  );
}

/** Deletes all of the user's chat messages. */
export function clearChatMessages(userId: string): Promise<void> {
  return runQuery(
    supabase.from("chat_messages").delete().eq("user_id", userId),
    "Could not clear your chat history.",
  ).then(() => undefined);
}

/* ----------------------------------------------------------- query keys */

/** React Query keys for the data helpers above. Everything is scoped per user. */
export const dataKeys = {
  myMeetings: (userId: string) => ["meetings", "mine", userId] as const,
  projects: (userId: string) => ["projects", userId] as const,
  project: (id: string) => ["project", id] as const,
  projectMeetings: (id: string) => ["project", id, "meetings"] as const,
  chat: (userId: string) => ["chat-messages", userId] as const,
  search: (q: string) => ["search", q] as const,
};

/* ----------------------------------------------------------------- chat */

/**
 * Sends one chat message; the server loads the history, answers and saves both messages.
 * The server function is imported lazily so it is not part of the app-shell bundle.
 */
export async function askChat(message: string): Promise<string> {
  const { askChatBot } = await import("@/lib/ai.functions");
  const result = await askChatBot({ data: { message } });
  if (!result?.reply) throw new Error("The assistant did not reply. Please try again.");
  return result.reply;
}
