import { GoogleGenAI, type GenerateContentConfig, type ContentListUnion } from "@google/genai";

/**
 * Single place that decides which Gemini model is used.
 * - GEMINI_MODEL overrides the default model.
 * - GEMINI_FALLBACK_MODEL overrides the one fallback (set it to "none" to disable).
 * Every call has an overall deadline so a request never hangs the server.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";
export const DEFAULT_GEMINI_FALLBACK_MODEL = "gemini-3.5-flash-lite";
export const AI_CALL_DEADLINE_MS = 25_000;
const RETRY_DELAY_MS = 1_000;

export function getModelChain(preferred?: string): string[] {
  const primary = preferred?.trim() || process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const fallbackEnv = process.env.GEMINI_FALLBACK_MODEL?.trim();
  const fallback = fallbackEnv === "none" ? "" : fallbackEnv || DEFAULT_GEMINI_FALLBACK_MODEL;
  return fallback && fallback !== primary ? [primary, fallback] : [primary];
}

let client: GoogleGenAI | undefined;
function getClient(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error("[ai] GEMINI_API_KEY is not set");
    throw new Error("AI features are not configured on the server.");
  }
  client ??= new GoogleGenAI({ apiKey: key });
  return client;
}

export interface GenerateOptions {
  contents: ContentListUnion;
  config?: Omit<GenerateContentConfig, "abortSignal">;
  /** Preferred model for this call; the configured fallback still applies. */
  model?: string;
  deadlineMs?: number;
}

export interface GenerateResult {
  text: string;
  model: string;
}

type Failure = "auth" | "quota" | "transient" | "not_found" | "timeout" | "other";

function classify(err: unknown): Failure {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (/AbortError|aborted/i.test(msg)) return "timeout";
  if (/401|403|UNAUTHENTICATED|PERMISSION_DENIED|API key not valid/i.test(msg)) return "auth";
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) return "quota";
  if (/404|NOT_FOUND|is not found|not supported/i.test(msg)) return "not_found";
  if (/500|502|503|504|UNAVAILABLE|INTERNAL|overloaded|high demand|fetch failed/i.test(msg))
    return "transient";
  return "other";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Calls Gemini with the configured model and at most one fallback model,
 * retrying a transient error once per model, all within one overall deadline.
 * Throws a user-friendly Error when no model produced a response.
 */
export async function generate(opts: GenerateOptions): Promise<GenerateResult> {
  const ai = getClient();
  const deadline = Date.now() + (opts.deadlineMs ?? AI_CALL_DEADLINE_MS);
  let last: Failure = "other";

  for (const model of getModelChain(opts.model)) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 500) {
        throw new Error("The AI service took too long to respond. Please try again.");
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), remaining);
      try {
        const res = await ai.models.generateContent({
          model,
          contents: opts.contents,
          config: { ...opts.config, abortSignal: controller.signal },
        });
        return { text: res.text ?? "", model };
      } catch (err) {
        last = classify(err);
        console.warn(
          `[ai] ${model} attempt ${attempt + 1} failed (${last}):`,
          err instanceof Error ? err.message : err,
        );
        if (last === "auth") {
          throw new Error("The AI service rejected the server's credentials.");
        }
        if (last === "timeout") {
          throw new Error("The AI service took too long to respond. Please try again.");
        }
        if (last === "transient" && attempt === 0 && deadline - Date.now() > RETRY_DELAY_MS + 500) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        break; // quota / not found / other / second transient failure -> next model
      } finally {
        clearTimeout(timer);
      }
    }
  }

  if (last === "quota") {
    throw new Error("The AI service quota is exhausted. Please try again later.");
  }
  throw new Error("The AI service is unavailable right now. Please try again in a minute.");
}

/** Parses a JSON response; throws a friendly error on malformed output. */
export function parseJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned || "null");
  } catch {
    throw new Error("The AI returned an unexpected response. Please try again.");
  }
}
