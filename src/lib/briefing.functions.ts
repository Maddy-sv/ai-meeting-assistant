import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateForUser } from "@/server/ai/usage";
import { BRIEFING_SYSTEM, asData } from "@/server/ai/prompts";
import { parseInput, uuid } from "@/server/validation";
import { fail, requireOwnedMeeting } from "@/server/meetings";

export interface MeetingBriefing {
  previousMeetings: { id: string; title: string; date: string; executiveSummary: string | null }[];
  openTasks: {
    id: string;
    title: string;
    assignee: string | null;
    deadline: string | null;
    status: string;
    meetingTitle: string;
  }[];
  recentDecisions: { description: string; meetingTitle: string }[];
  /** Short AI-written briefing; null when the AI is unavailable or there is nothing to brief. */
  narrative: string | null;
}

const PREVIOUS_LIMIT = 5;
const PROJECT_LIMIT = 10;
const DECISION_LIMIT = 10;

const BriefingInput = z.object({ meetingId: uuid });

/**
 * Context to prepare for a meeting: earlier meetings in the same project (or,
 * without a project, the caller's last completed meetings), their open tasks
 * and recent decisions, plus an optional AI narrative.
 */
export const getMeetingBriefing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof BriefingInput>) => parseInput(BriefingInput, input))
  .handler(async ({ data, context }): Promise<MeetingBriefing> => {
    const { supabase, userId } = context;
    const meeting = await requireOwnedMeeting(supabase, userId, data.meetingId);

    let query = supabase
      .from("meetings")
      .select("id, title, scheduled_at, created_at")
      .eq("host_id", userId)
      .eq("status", "completed")
      .neq("id", meeting.id)
      .order("scheduled_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    query = meeting.project_id
      ? query.eq("project_id", meeting.project_id).limit(PROJECT_LIMIT)
      : query.limit(PREVIOUS_LIMIT);
    const { data: previous, error: prevErr } = await query;
    if (prevErr) fail("load previous meetings", prevErr, "Could not load earlier meetings.");

    const meetings = previous ?? [];
    if (meetings.length === 0) {
      return { previousMeetings: [], openTasks: [], recentDecisions: [], narrative: null };
    }

    const ids = meetings.map((m) => m.id);
    const titles = new Map(meetings.map((m) => [m.id, m.title]));
    const [summaries, tasks, decisions] = await Promise.all([
      supabase.from("ai_summaries").select("meeting_id, executive_summary").in("meeting_id", ids),
      supabase
        .from("action_items")
        .select("id, title, assignee, deadline, status, meeting_id")
        .in("meeting_id", ids)
        .neq("status", "done")
        .order("deadline", { ascending: true, nullsFirst: false }),
      supabase
        .from("decisions")
        .select("description, meeting_id, created_at")
        .in("meeting_id", ids)
        .order("created_at", { ascending: false })
        .limit(DECISION_LIMIT),
    ]);
    if (summaries.error) fail("load summaries", summaries.error, "Could not load summaries.");
    if (tasks.error) fail("load open tasks", tasks.error, "Could not load open tasks.");
    if (decisions.error) fail("load decisions", decisions.error, "Could not load decisions.");

    const summaryBy = new Map(
      (summaries.data ?? []).map((s) => [s.meeting_id, s.executive_summary]),
    );

    const briefing: MeetingBriefing = {
      previousMeetings: meetings.map((m) => ({
        id: m.id,
        title: m.title,
        date: m.scheduled_at ?? m.created_at,
        executiveSummary: summaryBy.get(m.id) ?? null,
      })),
      openTasks: (tasks.data ?? []).map((t) => ({
        id: t.id,
        title: t.title,
        assignee: t.assignee,
        deadline: t.deadline,
        status: t.status,
        meetingTitle: titles.get(t.meeting_id) ?? "",
      })),
      recentDecisions: (decisions.data ?? []).map((d) => ({
        description: d.description,
        meetingTitle: titles.get(d.meeting_id) ?? "",
      })),
      narrative: null,
    };

    if (!process.env.GEMINI_API_KEY) return briefing;

    const records = [
      ...briefing.previousMeetings.map(
        (m) => `Meeting "${m.title}" (${m.date}): ${m.executiveSummary ?? "no summary"}`,
      ),
      "Open tasks:",
      ...briefing.openTasks.map(
        (t) =>
          `- ${t.title} (${t.status}; ${t.assignee ?? "unassigned"}; due ${t.deadline ?? "not set"}; from "${t.meetingTitle}")`,
      ),
      "Decisions:",
      ...briefing.recentDecisions.map((d) => `- ${d.description} (from "${d.meetingTitle}")`),
    ].join("\n");

    try {
      const res = await generateForUser(supabase, userId, "getMeetingBriefing", {
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Upcoming meeting: ${meeting.title}\n\n${asData("earlier_meetings", records, 30_000)}`,
              },
            ],
          },
        ],
        config: { systemInstruction: BRIEFING_SYSTEM, temperature: 0.3 },
      });
      briefing.narrative = res.text.trim() || null;
    } catch (err) {
      // The briefing data is still useful without the narrative; the failure is
      // recorded in ai_usage and logged here.
      console.warn("[briefing] narrative unavailable:", err instanceof Error ? err.message : err);
    }
    return briefing;
  });
