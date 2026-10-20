import { createClient } from "npm:@supabase/supabase-js@2";
import { escapeHtml, formatPlatform, safeHttpsUrl, sendEmail } from "../_shared/email.ts";

const WINDOW_HOURS = 24;
const BATCH_LIMIT = 200;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

function formatWhen(iso: string, timeZone: string | null): string {
  const d = new Date(iso);
  try {
    return d.toLocaleString("en-GB", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: timeZone || "UTC",
      timeZoneName: "short",
    });
  } catch {
    return (
      d.toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: "UTC" }) + " UTC"
    );
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed." });

  const secret = Deno.env.get("REMINDERS_CRON_SECRET");
  const provided = req.headers.get("x-cron-secret") ?? "";
  if (!secret || !timingSafeEqual(provided, secret)) return json(401, { error: "Unauthorized." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json(500, { error: "Server is not configured." });
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date();
  const until = new Date(now.getTime() + WINDOW_HOURS * 3600 * 1000);
  const { data: meetings, error } = await supabase
    .from("meetings")
    .select("id, host_id, title, platform, meeting_link, scheduled_at")
    .is("reminder_sent_at", null)
    .neq("status", "completed")
    .gte("scheduled_at", now.toISOString())
    .lte("scheduled_at", until.toISOString())
    .order("scheduled_at")
    .limit(BATCH_LIMIT);
  if (error) {
    console.error("Failed to load meetings:", error.message);
    return json(500, { error: "Could not load meetings." });
  }

  let sent = 0;
  const failures: string[] = [];

  for (const m of meetings ?? []) {
    const { data: claimed, error: claimError } = await supabase
      .from("meetings")
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq("id", m.id)
      .is("reminder_sent_at", null)
      .select("id");
    if (claimError) {
      failures.push(m.id);
      console.error("Claim failed for", m.id, claimError.message);
      continue;
    }
    if (!claimed || claimed.length === 0) continue;

    const { data: profile } = await supabase
      .from("profiles")
      .select("email, full_name, time_zone")
      .eq("id", m.host_id)
      .maybeSingle();
    let email: string | null = profile?.email ?? null;
    if (!email) {
      const { data: u } = await supabase.auth.admin.getUserById(m.host_id);
      email = u?.user?.email ?? null;
    }

    const when = formatWhen(m.scheduled_at, profile?.time_zone ?? null);
    const link = safeHttpsUrl(m.meeting_link);
    const name = profile?.full_name ? ` ${profile.full_name}` : "";

    try {
      if (!email) throw new Error("No email address for host");
      await sendEmail({
        to: email,
        subject: `Reminder: ${String(m.title).slice(0, 150)}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Meeting reminder</h2>
            <p>Hi${escapeHtml(name)},</p>
            <p>You have a meeting coming up.</p>
            <ul style="line-height: 1.8;">
              <li><strong>Title:</strong> ${escapeHtml(m.title)}</li>
              <li><strong>When:</strong> ${escapeHtml(when)}</li>
              <li><strong>Platform:</strong> ${escapeHtml(formatPlatform(m.platform))}</li>
            </ul>
            ${link ? `<p><a href="${escapeHtml(link)}">Join meeting</a></p>` : ""}
            <p>AI Powered Meeting Companion</p>
          </div>`,
      });
    } catch (err) {
      await supabase.from("meetings").update({ reminder_sent_at: null }).eq("id", m.id);
      failures.push(m.id);
      console.error("Reminder email failed for", m.id, err instanceof Error ? err.message : err);
      continue;
    }

    const { error: notifError } = await supabase.from("notifications").insert({
      user_id: m.host_id,
      type: "meeting_reminder",
      title: `Upcoming: ${String(m.title).slice(0, 150)}`,
      body: `Starts ${when}`,
      link: `/meetings/${m.id}`,
    });
    if (notifError) console.error("Notification insert failed for", m.id, notifError.message);
    sent++;
  }

  return json(failures.length ? 207 : 200, {
    checked: meetings?.length ?? 0,
    sent,
    failed: failures.length,
  });
});
