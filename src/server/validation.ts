import { z, ZodError, type ZodTypeAny } from "zod";

export const MB = 1024 * 1024;
export const MAX_AUDIO_BYTES = 15 * MB;
export const MAX_SCREENSHOT_BYTES = 4 * MB;
export const MAX_SCREENSHOTS = 3;

const DATA_URL_PREFIX = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)(;[a-z0-9=.+-]+)*;base64,/i;

/** Splits an optional data-URL prefix from base64 content. */
export function splitBase64(input: string): { mimeType: string | null; data: string } {
  const m = DATA_URL_PREFIX.exec(input);
  return m
    ? { mimeType: m[1].toLowerCase(), data: input.slice(m[0].length) }
    : { mimeType: null, data: input };
}

/** Decoded size in bytes of a base64 string (with or without data-URL prefix). */
export function base64Bytes(input: string): number {
  const { data } = splitBase64(input);
  const clean = data.replace(/\s/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

export function base64Field(maxBytes: number, label: string) {
  // Allow a little room for a data-URL prefix in the raw string length.
  return z
    .string()
    .min(1, `${label} is empty`)
    .max(Math.ceil((maxBytes * 4) / 3) + 256, `${label} is too large`)
    .refine((s) => /^[A-Za-z0-9+/=\s]*$/.test(splitBase64(s).data), `${label} is not valid base64`)
    .refine((s) => base64Bytes(s) <= maxBytes, `${label} is too large`);
}

export const uuid = z.string().uuid("Invalid id");

/** Parses input with a zod schema and turns validation errors into one readable message. */
export function parseInput<S extends ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  try {
    return schema.parse(input);
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
      throw new Error(`Invalid request. ${where}${issue?.message ?? "Check your input."}`);
    }
    throw err;
  }
}
