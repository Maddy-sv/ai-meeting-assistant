// Shared helpers for the email edge functions.

export const DEFAULT_EMAIL_FROM = "AI Meeting Companion <onboarding@resend.dev>";

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Returns the URL if it is a valid https link, otherwise null. */
export function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function formatPlatform(platform: unknown): string {
  const p = typeof platform === "string" ? platform : "";
  const known: Record<string, string> = {
    google_meet: "Google Meet",
    teams: "Microsoft Teams",
    zoom: "Zoom",
    manual: "In person / other",
  };
  return known[p] ?? (p.replace(/_/g, " ").slice(0, 50) || "Not specified");
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) throw new Error("Email is not configured (RESEND_API_KEY is missing).");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      from: Deno.env.get("EMAIL_FROM") || DEFAULT_EMAIL_FROM,
      to: params.to,
      subject: params.subject,
      html: params.html,
    }),
  });
  if (!res.ok) {
    console.error("Resend error:", res.status, await res.text());
    throw new Error("The email service rejected the message.");
  }
}
