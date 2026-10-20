/**
 * Typed wrappers around the Postgres RPCs and columns added by the revamp
 * migration (`supabase/migrations/20261020120000_revamp_core.sql`).
 *
 * TEMPORARY CASTS: until the regenerated `types.ts` is merged, the generated
 * `Database` type does not know these functions/columns, so `untypedRpc` and the
 * `*Row` types below bridge the gap. After the merge, `untypedRpc(...)` calls
 * can become `supabase.rpc(...)` and the row types can use `Tables<...>`.
 * This is the only file that contains such casts.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
type UntypedRpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;
};

async function untypedRpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase as unknown as UntypedRpcClient).rpc(fn, args);
  if (error) {
    console.error(`[rpc] ${fn} failed`, error);
    throw new Error(friendlyRpcError(error));
  }
  return data as T;
}

function friendlyRpcError(error: { message: string; code?: string }): string {
  // P0001 = RAISE EXCEPTION in our own SQL functions; those messages are written for users
  // (e.g. "You cannot remove your own admin role").
  if (error.code === "P0001") return error.message;
  if (error.code === "42501") return "You don't have permission to do that.";
  return "Something went wrong. Please try again.";
}

/* ------------------------------------------------------------------ rows */

/** `profiles` row including the revamp columns `is_active` and `email`. */
export type ProfileRow = Tables<"profiles"> & {
  is_active?: boolean;
  email?: string | null;
};

/** `notifications` row including the revamp column `link`. */
export type NotificationRow = Tables<"notifications"> & { link?: string | null };

/* ------------------------------------------------------------------ RPCs */

/** True when the signed-in user has the admin role (`public.is_admin()`). */
export function isAdmin(): Promise<boolean> {
  return untypedRpc<boolean>("is_admin").then(Boolean);
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
export function adminOverview(): Promise<AdminOverview> {
  return untypedRpc<AdminOverview>("admin_overview");
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
export function adminListUsers(): Promise<AdminUser[]> {
  return untypedRpc<AdminUser[] | null>("admin_list_users").then((r) => r ?? []);
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
export function adminListMeetings(): Promise<AdminMeeting[]> {
  return untypedRpc<AdminMeeting[] | null>("admin_list_meetings").then((r) => r ?? []);
}

export function adminSetUserRole(target: string, makeAdmin: boolean): Promise<void> {
  return untypedRpc<void>("admin_set_user_role", { target, make_admin: makeAdmin });
}

export function adminSetUserActive(target: string, active: boolean): Promise<void> {
  return untypedRpc<void>("admin_set_user_active", { target, active });
}

export interface AdminAiUsage {
  total: number;
  today: number;
  failures_today: number;
  avg_duration_ms: number | null;
  by_function: { fn: string; count: number; failures: number }[];
  daily: { day: string; count: number }[];
}
export function adminAiUsage(): Promise<AdminAiUsage> {
  return untypedRpc<AdminAiUsage>("admin_ai_usage");
}

export interface SeedDemoResult {
  project_id: string;
  meeting_ids: string[];
}
/** Inserts the sample research-scenario workspace for the calling user only. */
export function seedDemoWorkspace(): Promise<SeedDemoResult> {
  return untypedRpc<SeedDemoResult>("seed_demo_workspace");
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
export function searchWorkspace(q: string): Promise<SearchResult[]> {
  return untypedRpc<SearchResult[] | null>("search_workspace", { q }).then((r) => r ?? []);
}

/* ------------------------------------------------------ untyped tables */
/*
 * The generated `Database` type does not yet describe `projects`, `meetings.project_id`
 * or `chat_messages`. These helpers query them through an untyped client and return
 * explicit row types, so pages stay fully typed. After `types.ts` is regenerated they can
 * switch to the typed `supabase` client without changing their signatures.
 */

type DbError = { message: string; code?: string };
type DbResult = { data: unknown; error: DbError | null };
/** Minimal structural view of the PostgREST query builder used below. */
interface UntypedQuery extends PromiseLike<DbResult> {
  select(columns?: string): UntypedQuery;
  insert(values: Record<string, unknown> | Record<string, unknown>[]): UntypedQuery;
  update(values: Record<string, unknown>): UntypedQuery;
  delete(): UntypedQuery;
  eq(column: string, value: unknown): UntypedQuery;
  in(column: string, values: unknown[]): UntypedQuery;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): UntypedQuery;
  single(): UntypedQuery;
  maybeSingle(): UntypedQuery;
}
type UntypedTableClient = { from: (table: string) => UntypedQuery };

function untypedFrom(table: string): UntypedQuery {
  return (supabase as unknown as UntypedTableClient).from(table);
}

async function runQuery<T>(query: PromiseLike<DbResult>, failure: string): Promise<T> {
  const { data, error } = await query;
  if (error) {
    console.error(`[db] ${failure}`, error);
    throw new Error(error.code === "42501" ? "You don't have permission to do that." : failure);
  }
  return data as T;
}

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  created_at: string;
}

const PROJECT_COLUMNS = "id, name, description, owner_id, created_at";

/** The user's projects, newest first. */
export function listProjects(ownerId: string): Promise<ProjectRow[]> {
  return runQuery<ProjectRow[] | null>(
    untypedFrom("projects")
      .select(PROJECT_COLUMNS)
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false }),
    "Could not load your projects.",
  ).then((r) => r ?? []);
}

/** One project, or null when it does not exist or is not visible to the caller. */
export function getProject(id: string): Promise<ProjectRow | null> {
  return runQuery<ProjectRow | null>(
    untypedFrom("projects").select(PROJECT_COLUMNS).eq("id", id).maybeSingle(),
    "Could not load this project.",
  );
}

export function createProject(input: {
  ownerId: string;
  name: string;
  description: string | null;
}): Promise<ProjectRow> {
  return runQuery<ProjectRow>(
    untypedFrom("projects")
      .insert({ owner_id: input.ownerId, name: input.name, description: input.description })
      .select(PROJECT_COLUMNS)
      .single(),
    "Could not create the project.",
  );
}

export function updateProject(
  id: string,
  input: { name: string; description: string | null },
): Promise<void> {
  return runQuery<void>(
    untypedFrom("projects")
      .update({ name: input.name, description: input.description })
      .eq("id", id),
    "Could not save the project.",
  );
}

/** Deletes a project. Its meetings are kept (`meetings.project_id` becomes null). */
export function deleteProject(id: string): Promise<void> {
  return runQuery<void>(
    untypedFrom("projects").delete().eq("id", id),
    "Could not delete the project.",
  );
}

/** Meeting columns used by the list, calendar and project pages (includes `project_id`). */
export interface MeetingListRow {
  id: string;
  title: string;
  platform: string;
  status: string;
  scheduled_at: string | null;
  started_at: string | null;
  created_at: string;
  duration_seconds: number | null;
  meeting_link: string | null;
  project_id: string | null;
  google_event_id: string | null;
}

const MEETING_LIST_COLUMNS =
  "id, title, platform, status, scheduled_at, started_at, created_at, duration_seconds, meeting_link, project_id, google_event_id";

/** Meetings hosted by the user, newest first. */
export function listMyMeetings(hostId: string): Promise<MeetingListRow[]> {
  return runQuery<MeetingListRow[] | null>(
    untypedFrom("meetings")
      .select(MEETING_LIST_COLUMNS)
      .eq("host_id", hostId)
      .order("created_at", { ascending: false }),
    "Could not load your meetings.",
  ).then((r) => r ?? []);
}

/** Meetings linked to a project, latest scheduled first. */
export function listProjectMeetings(projectId: string): Promise<MeetingListRow[]> {
  return runQuery<MeetingListRow[] | null>(
    untypedFrom("meetings")
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
  return runQuery<MeetingListRow[] | null>(
    untypedFrom("meetings")
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
  return runQuery<ChatMessageRow[] | null>(
    untypedFrom("chat_messages")
      .select("id, role, content, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    "Could not load your chat history.",
  ).then((r) => r ?? []);
}

/** Deletes all of the user's chat messages. */
export function clearChatMessages(userId: string): Promise<void> {
  return runQuery<void>(
    untypedFrom("chat_messages").delete().eq("user_id", userId),
    "Could not clear your chat history.",
  );
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
