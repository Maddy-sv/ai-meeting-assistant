import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { generate, type GenerateOptions, type GenerateResult } from "./gemini";

export const DEFAULT_AI_DAILY_LIMIT = 200;
export const DAILY_LIMIT_MESSAGE = "Daily AI limit reached. Try again tomorrow.";

type Client = SupabaseClient<Database>;

export function getDailyLimit(): number {
  const raw = Number(process.env.AI_DAILY_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_AI_DAILY_LIMIT;
}

function startOfUtcDay(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Throws when the user has used up today's AI requests. */
export async function assertWithinDailyLimit(supabase: Client, userId: string): Promise<void> {
  const { count, error } = await supabase
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", startOfUtcDay());
  if (error) {
    console.error("[ai] usage count failed:", error.message);
    throw new Error("Could not check your AI usage. Please try again.");
  }
  if ((count ?? 0) >= getDailyLimit()) {
    throw new Error(DAILY_LIMIT_MESSAGE);
  }
}

async function recordUsage(
  supabase: Client,
  row: { userId: string; fn: string; model: string | null; ok: boolean; durationMs: number },
): Promise<void> {
  const { error } = await supabase.from("ai_usage").insert({
    user_id: row.userId,
    fn: row.fn,
    model: row.model,
    ok: row.ok,
    duration_ms: Math.round(row.durationMs),
  });
  // Logging must not turn a successful AI answer into a failure, but it is reported.
  if (error) console.error("[ai] failed to record usage:", error.message);
}

/**
 * Runs one Gemini call for a user: checks the daily limit, calls the model and
 * records the outcome in ai_usage. Errors are re-thrown unchanged.
 */
export async function generateForUser(
  supabase: Client,
  userId: string,
  fn: string,
  opts: GenerateOptions,
): Promise<GenerateResult> {
  await assertWithinDailyLimit(supabase, userId);
  const started = Date.now();
  try {
    const result = await generate(opts);
    await recordUsage(supabase, {
      userId,
      fn,
      model: result.model,
      ok: true,
      durationMs: Date.now() - started,
    });
    return result;
  } catch (err) {
    await recordUsage(supabase, {
      userId,
      fn,
      model: opts.model ?? null,
      ok: false,
      durationMs: Date.now() - started,
    });
    throw err;
  }
}
