import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { generate, type GenerateOptions, type GenerateResult } from "./gemini";

export const DEFAULT_AI_DAILY_LIMIT = 200;
export const DEFAULT_AI_TRANSCRIBE_DAILY_LIMIT = 2000;
export const DAILY_LIMIT_MESSAGE = "Daily AI limit reached. Try again tomorrow.";
export const TRANSCRIBE_LIMIT_MESSAGE =
  "Daily transcription limit reached. Live transcription will resume tomorrow.";

export const TRANSCRIPTION_FNS = ["transcribeRemoteAudio"] as const;

function isTranscriptionFn(fn: string): boolean {
  return (TRANSCRIPTION_FNS as readonly string[]).includes(fn);
}

type Client = SupabaseClient<Database>;

export function getDailyLimit(): number {
  const raw = Number(process.env.AI_DAILY_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_AI_DAILY_LIMIT;
}

export function getTranscribeDailyLimit(): number {
  const raw = Number(process.env.AI_TRANSCRIBE_DAILY_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_AI_TRANSCRIBE_DAILY_LIMIT;
}

function startOfUtcDay(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function assertWithinDailyLimit(
  supabase: Client,
  userId: string,
  fn = "",
): Promise<void> {
  const transcription = isTranscriptionFn(fn);
  const inList = `(${TRANSCRIPTION_FNS.join(",")})`;
  let query = supabase
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", startOfUtcDay());
  query = transcription ? query.in("fn", [...TRANSCRIPTION_FNS]) : query.not("fn", "in", inList);
  const { count, error } = await query;
  if (error) {
    console.error("[ai] usage count failed:", error.message);
    throw new Error("Could not check your AI usage. Please try again.");
  }
  if (transcription) {
    if ((count ?? 0) >= getTranscribeDailyLimit()) throw new Error(TRANSCRIBE_LIMIT_MESSAGE);
  } else if ((count ?? 0) >= getDailyLimit()) {
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

  if (error) console.error("[ai] failed to record usage:", error.message);
}

export async function generateForUser(
  supabase: Client,
  userId: string,
  fn: string,
  opts: GenerateOptions,
): Promise<GenerateResult> {
  await assertWithinDailyLimit(supabase, userId, fn);
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
