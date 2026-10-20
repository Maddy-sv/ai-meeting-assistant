// Sends a "meeting scheduled" confirmation to the signed-in user.
// The recipient is always the authenticated user's own email address.
import { createClient } from "npm:@supabase/supabase-js@2";
import { escapeHtml, formatPlatform, safeHttpsUrl, sendEmail } from "../_shared/email.ts";

const DEFAULT_ORIGINS = ["http://localhost:8080", "http://localhost:3000", "http://localhost:5173"];

function allowedOrigins(): string[] {
  const env = Deno.env.get("ALLOWED_ORIGINS");
  const list = env
    ? env
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean)
    : [];
  return list.length ? list : DEFAULT_ORIGINS;
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = allowedOrigins();
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    Vary: "Origin",
  };
}

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed." });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json(req, 401, { error: "Please sign in." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) return json(req, 500, { error: "Server is not configured." });

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(
    authHeader.slice("Bearer ".length),
  );
  const email = userData?.user?.email;
  if (userError || !email) return json(req, 401, { error: "Please sign in." });

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json(req, 400, { error: "Invalid request body." });
  }

  const title = typeof payload.title === "string" ? payload.title.trim().slice(0, 200) : "";
  if (!title) return json(req, 400, { error: "Meeting title is required." });

  const when = typeof payload.time === "string" ? new Date(payload.time) : null;
  const whenText =
    when && !isNaN(when.getTime())
      ? when.toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: "UTC" }) +
        " UTC"
      : "Not specified";
  const link = safeHttpsUrl(payload.link);

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Your meeting is scheduled</h2>
      <p>You have scheduled <strong>${escapeHtml(title)}</strong>.</p>
      <ul style="line-height: 1.8;">
        <li><strong>Date and time:</strong> ${escapeHtml(whenText)}</li>
        <li><strong>Platform:</strong> ${escapeHtml(formatPlatform(payload.platform))}</li>
        ${link ? `<li><strong>Link:</strong> <a href="${escapeHtml(link)}">${escapeHtml(link)}</a></li>` : ""}
      </ul>
      <p>AI Powered Meeting Companion</p>
    </div>`;

  try {
    await sendEmail({ to: email, subject: `Meeting scheduled: ${title}`, html });
  } catch (err) {
    return json(req, 502, { error: err instanceof Error ? err.message : "Email failed." });
  }
  return json(req, 200, { success: true });
});
