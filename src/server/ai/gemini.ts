import { GoogleGenAI, type GenerateContentConfig, type ContentListUnion } from "@google/genai";

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";
export const DEFAULT_GEMINI_FALLBACK_MODEL = "gemini-3.5-flash-lite";
export const AI_CALL_DEADLINE_MS = 90_000;
const ATTEMPT_TIMEOUT_MS = 35_000;
const RETRY_DELAY_MS = 2_000;

export function getModelChain(preferred?: string): string[] {
  const primary = preferred?.trim() || process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const fallbackEnv = process.env.GEMINI_FALLBACK_MODEL?.trim();
  const fallback = fallbackEnv === "none" ? "" : fallbackEnv || DEFAULT_GEMINI_FALLBACK_MODEL;
  return fallback && fallback !== primary ? [primary, fallback] : [primary];
}

let client: GoogleGenAI | undefined;
let activeApiKey: string | undefined;
function getClient(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error("[ai] GEMINI_API_KEY is not set");
    throw new Error("AI features are not configured on the server.");
  }
  if (!client || activeApiKey !== key) {
    activeApiKey = key;
    client = new GoogleGenAI({ apiKey: key });
  }
  return client;
}

export interface GenerateOptions {
  contents: ContentListUnion;
  config?: Omit<GenerateContentConfig, "abortSignal">;

  model?: string;
  deadlineMs?: number;
}

export interface GenerateResult {
  text: string;
  model: string;
}

export const AI_KEY_INVALID_MESSAGE =
  "Invalid Gemini API key. Ask the administrator to set a valid GEMINI_API_KEY from Google AI Studio.";
export const AI_QUOTA_MESSAGE =
  "AI rate limit reached. The request was retried automatically. Please wait a few seconds and click Retry.";
export const AI_BUSY_MESSAGE =
  "The AI model is currently experiencing high demand. Please try again in a few moments.";

export class AiQuotaError extends Error {
  constructor() {
    super(AI_QUOTA_MESSAGE);
    this.name = "AiQuotaError";
  }
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

export async function generate(opts: GenerateOptions): Promise<GenerateResult> {
  const ai = getClient();
  const deadline = Date.now() + (opts.deadlineMs ?? AI_CALL_DEADLINE_MS);
  const chain = getModelChain(opts.model);
  const plan = chain.length > 1 ? [chain[0], chain[1], chain[0], chain[1]] : [chain[0], chain[0]];
  let last: Failure = "other";

  for (const [attempt, model] of plan.entries()) {
    const remaining = deadline - Date.now();
    if (remaining <= 1_000) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(remaining, ATTEMPT_TIMEOUT_MS));
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
      if (last === "auth") throw new Error(AI_KEY_INVALID_MESSAGE);
      if (last === "other") break;
      if (attempt < plan.length - 1 && deadline - Date.now() > RETRY_DELAY_MS + 1_000) {
        await sleep(last === "quota" ? RETRY_DELAY_MS * 2 : RETRY_DELAY_MS);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  if (last === "quota") throw new AiQuotaError();
  if (last === "transient") throw new Error(AI_BUSY_MESSAGE);
  if (last === "timeout")
    throw new Error("The AI service took too long to respond. Please try again.");
  throw new Error("The AI service is unavailable right now. Please try again in a minute.");
}

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
