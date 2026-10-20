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
