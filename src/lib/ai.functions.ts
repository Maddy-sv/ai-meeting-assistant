import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type SummaryPayload = {
  executive_summary: string;
  key_points: string[];
  risks: string[];
  follow_ups: string[];
  action_items: { title: string; assignee: string | null; deadline: string | null }[];
  decisions: { description: string; made_by: string | null }[];
};

export const summarizeMeeting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { meetingId: string }) => {
    if (!input?.meetingId || typeof input.meetingId !== "string") {
      throw new Error("meetingId is required");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const { data: meeting, error: mErr } = await supabase
      .from("meetings")
      .select("id, title, host_id")
      .eq("id", data.meetingId)
      .maybeSingle();
    if (mErr) throw mErr;
    if (!meeting || meeting.host_id !== userId) throw new Error("Meeting not found");

    const { data: segs } = await supabase
      .from("transcripts")
      .select("speaker, content, spoken_at, segment_index")
      .eq("meeting_id", data.meetingId)
      .order("segment_index", { ascending: true });

    const transcript = (segs ?? []).map((s: any) => `${s.speaker}: ${s.content}`).join("\n");

    if (!transcript.trim()) {
      return {
        executive_summary: "No speech was captured during this meeting.",
        key_points: [],
        risks: [],
        follow_ups: [],
        action_items: [],
        decisions: [],
      } satisfies SummaryPayload;
    }

    const system = `You analyze meeting transcripts and return STRICT JSON only. Do not invent facts — only summarize what is present. If information is missing, return empty arrays or a short honest note.`;

    const user = `Meeting title: ${meeting.title}

Transcript:
${transcript}

Return JSON with this exact shape:
{
  "executive_summary": string (2-4 sentences based only on the transcript),
  "key_points": string[] (up to 6),
  "risks": string[] (up to 4),
  "follow_ups": string[] (up to 5),
  "action_items": [{"title": string, "assignee": string|null, "deadline": string|null}],
  "decisions": [{"description": string, "made_by": string|null}]
}`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
      },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429) throw new Error("AI rate limit reached, please retry shortly.");
      if (res.status === 402) throw new Error("AI credits exhausted. Add credits to continue.");
      throw new Error(`AI error: ${text.slice(0, 200)}`);
    }

    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content ?? "{}";
    let parsed: SummaryPayload;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = {
        executive_summary: content.slice(0, 500),
        key_points: [],
        risks: [],
        follow_ups: [],
        action_items: [],
        decisions: [],
      };
    }

    // Persist to DB (replace prior summary)
    await supabase.from("ai_summaries").delete().eq("meeting_id", data.meetingId);
    await supabase.from("ai_summaries").insert({
      meeting_id: data.meetingId,
      executive_summary: parsed.executive_summary ?? "",
      key_points: parsed.key_points ?? [],
      risks: parsed.risks ?? [],
      follow_ups: parsed.follow_ups ?? [],
    });

    await supabase.from("action_items").delete().eq("meeting_id", data.meetingId);
    if (parsed.action_items?.length) {
      await supabase.from("action_items").insert(
        parsed.action_items.map((a) => ({
          meeting_id: data.meetingId,
          title: a.title,
          assignee: a.assignee,
          deadline: a.deadline,
        })),
      );
    }

    await supabase.from("decisions").delete().eq("meeting_id", data.meetingId);
    if (parsed.decisions?.length) {
      await supabase.from("decisions").insert(
        parsed.decisions.map((d) => ({
          meeting_id: data.meetingId,
          description: d.description,
          made_by: d.made_by,
        })),
      );
    }

    return parsed;
  });
