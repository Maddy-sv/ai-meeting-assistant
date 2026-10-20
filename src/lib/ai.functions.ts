import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildVerifiedCumulativeSummary,
  evidenceSupported,
  resolveDeadlineToISODate,
  resolveTaskAssignee,
  safeFormatDeadline,
} from "./continuous-memory";
import { AiQuotaError, parseJson } from "@/server/ai/gemini";
import { generateForUser } from "@/server/ai/usage";
import {
  CLEAN_SCHEMA,
  CLEAN_SYSTEM,
  EXTRACTION_SCHEMA,
  EXTRACTION_SYSTEM,
  PROJECT_SCHEMA,
  PROJECT_SYSTEM,
  SUMMARY_SCHEMA,
  SUMMARY_SYSTEM,
  TRANSCRIBE_SCHEMA,
  chatSystem,
  cleanPrompt,
  extractionPrompt,
  projectPrompt,
  summaryPrompt,
  transcribeSystem,
  transcriptText,
} from "@/server/ai/prompts";
import {
  MAX_AUDIO_BYTES,
  MAX_SCREENSHOTS,
  MAX_SCREENSHOT_BYTES,
  base64Field,
  parseInput,
  splitBase64,
  uuid,
} from "@/server/validation";
import {
  fail,
  getHostName,
  getParticipantNames,
  jsonStrings,
  replaceDecisions,
  requireOwnedMeeting,
  saveExtractedActionItems,
  type ActionItemRow,
  type DecisionRow,
} from "@/server/meetings";
import {
  reconcileAfterMeeting,
  reconcileTaskProgress,
  type TaskProgressResult,
} from "@/server/task-progress";

const str = (max: number) => z.string().trim().max(max);
const nullableStr = (max: number) =>
  z
    .string()
    .nullish()
    .transform((v) => (v && v.trim() ? v.trim().slice(0, max) : null));

const aiActionItem = z.object({
  title: z.string().transform((s) => s.trim().slice(0, 500)),
  assignee: nullableStr(200),
  deadline: nullableStr(100),
  status: z.string().nullish(),
});
const aiDecision = z.object({
  description: z.string().transform((s) => s.trim().slice(0, 1000)),
  made_by: nullableStr(200),
});
const strList = (n: number) =>
  z
    .array(z.string())
    .nullish()
    .transform((a) =>
      (a ?? [])
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, n),
    );

const aiSummary = z.object({
  executive_summary: z.string().transform((s) => s.trim()),
  key_points: strList(6),
  risks: strList(4),
  follow_ups: strList(5),
  action_items: z
    .array(aiActionItem)
    .nullish()
    .transform((a) => a ?? []),
  decisions: z
    .array(aiDecision)
    .nullish()
    .transform((a) => a ?? []),
});

const aiExtractedItem = aiActionItem.extend({
  evidence: z
    .string()
    .nullish()
    .transform((v) => (v ?? "").trim().slice(0, 200)),
});

const aiExtraction = z.object({
  action_items: z
    .array(aiExtractedItem)
    .nullish()
    .transform((a) => a ?? []),
  decisions: z
    .array(aiDecision)
    .nullish()
    .transform((a) => a ?? []),
});

function parseAi<S extends z.ZodTypeAny>(schema: S, text: string): z.output<S> {
  const result = schema.safeParse(parseJson(text));
  if (!result.success) {
    console.warn("[ai] response did not match schema:", result.error.issues[0]);
    throw new Error("The AI returned an unexpected response. Please try again.");
  }
  return result.data;
}

type ExtractedItem = {
  title: string;
  assignee: string | null;
  deadline: string | null;
  status?: string | null;
};

function withTaskDefaults(
  items: ExtractedItem[],
  followUps: string[],
  hostName: string,
  participants: string[],
): ExtractedItem[] {
  const source =
    items.length > 0
      ? items
      : followUps.map((title) => ({ title: title.slice(0, 500), assignee: null, deadline: null }));
  return source
    .filter((a) => a.title.trim())
    .map((a) => ({
      ...a,
      assignee: resolveTaskAssignee(a.assignee, hostName, participants) ?? hostName,
    }));
}

type SummaryPayload = {
  executive_summary: string;
  key_points: string[];
  risks: string[];
  follow_ups: string[];
  action_items: { title: string; assignee: string | null; deadline: string | null }[];
  decisions: { description: string; made_by: string | null }[];
};

const SummarizeInput = z.object({
  meetingId: uuid,
  screenshots: z
    .array(base64Field(MAX_SCREENSHOT_BYTES, "Screenshot"))
    .max(MAX_SCREENSHOTS, `At most ${MAX_SCREENSHOTS} screenshots can be attached`)
    .optional(),
});

export const summarizeMeeting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: z.input<typeof SummarizeInput>) => parseInput(SummarizeInput, input))
  .handler(async ({ data, context }): Promise<SummaryPayload> => {
    const { supabase, userId } = context;
    const meeting = await requireOwnedMeeting(supabase, userId, data.meetingId);

    const { data: segs, error: segErr } = await supabase
      .from("transcripts")
      .select("speaker, content")
      .eq("meeting_id", meeting.id)
      .order("segment_index", { ascending: true });
    if (segErr) fail("load transcript", segErr, "Could not load the transcript.");

    const transcript = transcriptText(segs);
    if (!transcript.trim()) {
      throw new Error("This meeting has no transcript yet, so there is nothing to summarise.");
    }

    const [hostName, participants] = await Promise.all([
      getHostName(supabase, userId),
      getParticipantNames(supabase, meeting.id),
    ]);

    const textPart = {
      text: summaryPrompt({ title: meeting.title, hostName, participants, transcript }),
    };
    const imageParts = (data.screenshots ?? []).map((shot) => {
      const { mimeType, data: b64 } = splitBase64(shot);
      return { inlineData: { data: b64, mimeType: mimeType ?? "image/jpeg" } };
    });
    const summaryConfig = {
      systemInstruction: SUMMARY_SYSTEM,
      responseMimeType: "application/json",
      responseSchema: SUMMARY_SCHEMA,
      temperature: 0.2,
    };

    let res;
    try {
      res = await generateForUser(supabase, userId, "summarizeMeeting", {
        contents: [{ role: "user", parts: [textPart, ...imageParts] }],
        config: summaryConfig,
      });
    } catch (err) {
      if (!(err instanceof AiQuotaError) || imageParts.length === 0) throw err;
      console.warn(
        "[ai] summary with screenshots hit the quota, retrying with the transcript only",
      );
      res = await generateForUser(supabase, userId, "summarizeMeeting", {
        contents: [{ role: "user", parts: [textPart] }],
        config: summaryConfig,
      });
    }
    const parsed = parseAi(aiSummary, res.text);
    if (!parsed.executive_summary) {
      throw new Error("The AI returned an empty summary. Please try again.");
    }

    const { error: sumErr } = await supabase.from("ai_summaries").upsert(
      {
        meeting_id: meeting.id,
        executive_summary: parsed.executive_summary,
        key_points: parsed.key_points,
        risks: parsed.risks,
        follow_ups: parsed.follow_ups,
      },
      { onConflict: "meeting_id" },
    );
    if (sumErr) fail("save summary", sumErr, "Could not save the summary.");

    const savedItems = await saveExtractedActionItems(
      supabase,
      meeting,
      withTaskDefaults(parsed.action_items, parsed.follow_ups, hostName, participants),
      { hostName },
    );
    await replaceDecisions(supabase, meeting.id, parsed.decisions);
    await reconcileAfterMeeting(supabase, userId, meeting.id);

    const { error: notifErr } = await supabase.from("notifications").insert({
      user_id: userId,
      type: "summary_ready",
      title: `Summary ready: ${meeting.title}`.slice(0, 200),
      body: parsed.executive_summary.slice(0, 280),
      link: `/meetings/${meeting.id}`,
    });

    if (notifErr) console.error("[db] summary notification:", notifErr.message);

    return {
      executive_summary: parsed.executive_summary,
      key_points: parsed.key_points,
      risks: parsed.risks,
      follow_ups: parsed.follow_ups,
      action_items: savedItems.map((a) => ({
        title: a.title,
        assignee: a.assignee,
        deadline: a.deadline,
      })),
      decisions: parsed.decisions.map((d) => ({ description: d.description, made_by: d.made_by })),
    };
  });

const MeetingIdInput = z.object({ meetingId: uuid });

export const syncMeetingActionItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: z.input<typeof MeetingIdInput>) => parseInput(MeetingIdInput, input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ action_items: ActionItemRow[]; decisions: DecisionRow[] }> => {
      const { supabase, userId } = context;
      const meeting = await requireOwnedMeeting(supabase, userId, data.meetingId);

      const [hostName, participants, segsRes, summaryRes] = await Promise.all([
        getHostName(supabase, userId),
        getParticipantNames(supabase, meeting.id),
        supabase
          .from("transcripts")
          .select("speaker, content")
          .eq("meeting_id", meeting.id)
          .order("segment_index", { ascending: true }),
        supabase
          .from("ai_summaries")
          .select("executive_summary, key_points, follow_ups")
          .eq("meeting_id", meeting.id)
          .maybeSingle(),
      ]);
      if (segsRes.error) fail("load transcript", segsRes.error, "Could not load the transcript.");
      if (summaryRes.error) fail("load summary", summaryRes.error, "Could not load the summary.");

      const transcript = transcriptText(segsRes.data);
      const summary = summaryRes.data?.executive_summary ?? "";
      const keyPoints = jsonStrings(summaryRes.data?.key_points);
      const followUps = jsonStrings(summaryRes.data?.follow_ups);
      if (!transcript.trim() && !summary.trim()) {
        throw new Error("This meeting has no transcript or summary to extract tasks from.");
      }

      const res = await generateForUser(supabase, userId, "syncMeetingActionItems", {
        contents: [
          {
            role: "user",
            parts: [
              {
                text: extractionPrompt({
                  title: meeting.title,
                  hostName,
                  participants,
                  summary,
                  keyPoints,
                  transcript,
                }),
              },
            ],
          },
        ],
        config: {
          systemInstruction: EXTRACTION_SYSTEM,
          responseMimeType: "application/json",
          responseSchema: EXTRACTION_SCHEMA,
          temperature: 0.1,
        },
      });
      const parsed = parseAi(aiExtraction, res.text);
      const recordsText = `${transcript}\n${summary}\n${keyPoints.join("\n")}`;
      const supported = parsed.action_items.filter(
        (a) => a.title && evidenceSupported(a.evidence, recordsText),
      );
      if (supported.length < parsed.action_items.length) {
        console.warn(
          `[ai] dropped ${parsed.action_items.length - supported.length} task(s) without supporting evidence`,
        );
      }

      const action_items = await saveExtractedActionItems(
        supabase,
        meeting,
        withTaskDefaults(
          supported.map(({ evidence: _evidence, ...item }) => item),
          parsed.action_items.length > 0 ? [] : followUps,
          hostName,
          participants,
        ),
        { hostName, evidenceText: recordsText },
      );
      const decisions = await replaceDecisions(supabase, meeting.id, parsed.decisions);
      const progress = await reconcileAfterMeeting(supabase, userId, meeting.id);
      if (!progress || progress.updated === 0) return { action_items, decisions };
      const { data: refreshed, error: refreshErr } = await supabase
        .from("action_items")
        .select("*")
        .eq("meeting_id", meeting.id)
        .order("created_at", { ascending: true });
      if (refreshErr)
        fail("reload action items", refreshErr, "Could not load the meeting's tasks.");
      return { action_items: refreshed ?? action_items, decisions };
    },
  );

function assigneeNames(assignee: string | null): string[] {
  return (assignee ?? "")
    .split(/,|&|\band\b/i)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isAssignedTo(assignee: string | null, participantName: string): boolean {
  const full = participantName.trim().toLowerCase();
  const first = full.split(/\s+/)[0];
  return assigneeNames(assignee).some(
    (n) => n === full || (first.length > 1 && n.split(/\s+/)[0] === first),
  );
}

export const generateMeetingRecaps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: z.input<typeof MeetingIdInput>) => parseInput(MeetingIdInput, input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const meeting = await requireOwnedMeeting(supabase, userId, data.meetingId);

    const [summaryRes, actionsRes, participantsRes] = await Promise.all([
      supabase.from("ai_summaries").select("*").eq("meeting_id", meeting.id).maybeSingle(),
      supabase.from("action_items").select("*").eq("meeting_id", meeting.id),
      supabase.from("participants").select("*").eq("meeting_id", meeting.id),
    ]);
    if (summaryRes.error) fail("load summary", summaryRes.error, "Could not load the summary.");
    if (actionsRes.error) fail("load tasks", actionsRes.error, "Could not load the tasks.");
    if (participantsRes.error)
      fail("load participants", participantsRes.error, "Could not load the participants.");
    if (!summaryRes.data) throw new Error("Generate a summary before creating recaps.");

    const summary = summaryRes.data;
    const actions = actionsRes.data ?? [];

    return (participantsRes.data ?? []).map((p) => {
      const name = p.name.trim() || "Participant";
      const mine = actions.filter((a) => isAssignedTo(a.assignee, name));
      const others = actions.filter((a) => !mine.includes(a));
      const due = (d: string | null) =>
        d ? new Date(d).toLocaleDateString("en-GB") : "no deadline";

      let body = `Hi ${name},\n\nHere is the recap of "${meeting.title}".\n\n`;
      body += `Summary:\n${summary.executive_summary ?? ""}\n\n`;
      if (mine.length > 0) {
        body += `Your action items:\n`;
        for (const t of mine) body += `- ${t.title} (due ${due(t.deadline)})\n`;
        body += `\n`;
      } else {
        body += `You have no action items from this meeting.\n\n`;
      }
      if (others.length > 0) {
        body += `Other action items:\n`;
        for (const t of others) body += `- ${t.title} (${t.assignee || "unassigned"})\n`;
        body += `\n`;
      }
      body += `Sent from AI Powered Meeting Companion`;

      return {
        participantName: name,
        email: p.email,
        subject: `Meeting recap: ${meeting.title}`,
        body,
      };
    });
  });

const ProjectInput = z.object({ projectId: uuid });

export interface ProjectTimelineEntry {
  meeting_id: string;
  title: string;
  date: string;
  status: string;
  summary: string;
  highlights: string[];
}

export interface ProjectDecisionEntry {
  description: string;
  made_by: string | null;
  meeting_id: string | null;
  meeting_title: string | null;
  date: string | null;
}

export interface ProjectTaskEntry {
  title: string;
  assignee: string | null;
  deadline: string | null;
  status: string;
  meeting_id: string | null;
  meeting_title: string | null;
}

export interface ProjectSummaryReport {
  overview: string;
  progress_report: string;
  stats: {
    meetings: number;
    completed_meetings: number;
    tasks_total: number;
    tasks_done: number;
    tasks_open: number;
    decisions: number;
    participants: string[];
  };
  timeline: ProjectTimelineEntry[];
  key_decisions: ProjectDecisionEntry[];
  completed_tasks: ProjectTaskEntry[];
  open_tasks: ProjectTaskEntry[];
  risks: string[];
  next_steps: string[];
  suggested_agenda: string[];
  discrepancies: string[];
  ai_enhanced: boolean;
  generated_at: string;
}

const aiProjectReport = z.object({
  overview: z
    .string()
    .nullish()
    .transform((s) => (s ?? "").trim()),
  risks: strList(8),
  next_steps: strList(10),
  suggested_agenda: strList(6),
});

function dedupe(items: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

function shortDate(iso: string | null): string {
  if (!iso) return "date not recorded";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function taskLine(t: ProjectTaskEntry): string {
  const owner = t.assignee ? `owner ${t.assignee}` : "no owner";
  const due = t.deadline ? `due ${safeFormatDeadline(t.deadline)}` : "no deadline";
  const from = t.meeting_title ? `; from "${t.meeting_title}"` : "";
  return `${t.title} (${t.status.replace(/_/g, " ")}; ${owner}; ${due}${from})`;
}

function emptyProjectReport(overview: string): ProjectSummaryReport {
  return {
    overview,
    progress_report: overview,
    stats: {
      meetings: 0,
      completed_meetings: 0,
      tasks_total: 0,
      tasks_done: 0,
      tasks_open: 0,
      decisions: 0,
      participants: [],
    },
    timeline: [],
    key_decisions: [],
    completed_tasks: [],
    open_tasks: [],
    risks: [],
    next_steps: [],
    suggested_agenda: [],
    discrepancies: [],
    ai_enhanced: false,
    generated_at: new Date().toISOString(),
  };
}

export const generateProjectSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: z.input<typeof ProjectInput>) => parseInput(ProjectInput, input))
  .handler(async ({ data, context }): Promise<ProjectSummaryReport> => {
    const { supabase, userId } = context;

    const { data: project, error: pErr } = await supabase
      .from("projects")
      .select("id, name, owner_id")
      .eq("id", data.projectId)
      .maybeSingle();
    if (pErr) fail("load project", pErr, "Could not load the project.");
    if (!project || project.owner_id !== userId) throw new Error("Project not found.");

    const { data: meetingRows, error: mErr } = await supabase
      .from("meetings")
      .select("id, title, status, scheduled_at, started_at, created_at")
      .eq("project_id", project.id)
      .eq("host_id", userId);
    if (mErr) fail("load project meetings", mErr, "Could not load the project's meetings.");

    if (!meetingRows || meetingRows.length === 0) {
      return emptyProjectReport("No meetings found for this project yet.");
    }

    const meetings = meetingRows
      .map((m) => ({ ...m, date: m.started_at ?? m.scheduled_at ?? m.created_at }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const byId = new Map(meetings.map((m) => [m.id, m]));

    const ids = meetings.map((m) => m.id);
    const [summaries, actions, decisions, transcripts, participants] = await Promise.all([
      supabase
        .from("ai_summaries")
        .select("meeting_id, executive_summary, key_points, risks, follow_ups")
        .in("meeting_id", ids),
      supabase.from("action_items").select("*").in("meeting_id", ids),
      supabase.from("decisions").select("*").in("meeting_id", ids),
      supabase.from("transcripts").select("meeting_id, speaker, content").in("meeting_id", ids),
      supabase.from("participants").select("name").in("meeting_id", ids),
    ]);
    for (const r of [summaries, actions, decisions, transcripts, participants]) {
      if (r.error) fail("load project records", r.error, "Could not load the project's records.");
    }

    const participantNames = dedupe(
      (participants.data ?? []).map((p) => p.name.trim()).filter(Boolean),
      100,
    );

    const verified = buildVerifiedCumulativeSummary(
      { id: project.id, name: project.name },
      meetings.map((m) => ({ id: m.id, title: m.title, scheduled_at: m.date })),
      summaries.data ?? [],
      actions.data ?? [],
      decisions.data ?? [],
      transcripts.data ?? [],
      participantNames,
    );

    const summaryByMeeting = new Map((summaries.data ?? []).map((s) => [s.meeting_id, s]));
    const timeline: ProjectTimelineEntry[] = meetings.map((m) => {
      const s = summaryByMeeting.get(m.id);
      return {
        meeting_id: m.id,
        title: m.title,
        date: m.date,
        status: m.status,
        summary: s?.executive_summary?.trim() ?? "",
        highlights: jsonStrings(s?.key_points),
      };
    });

    const key_decisions: ProjectDecisionEntry[] = verified.verified_decisions.map((d) => {
      const m = d.meeting_id ? byId.get(d.meeting_id) : undefined;
      return {
        description: d.description,
        made_by: d.made_by?.trim() || null,
        meeting_id: m?.id ?? null,
        meeting_title: m?.title ?? null,
        date: m?.date ?? null,
      };
    });

    const toTask = (t: (typeof verified.verified_pending)[number]): ProjectTaskEntry => {
      const m = byId.get(t.origin_meeting_id);
      return {
        title: t.title,
        assignee: t.assignee,
        deadline: t.deadline,
        status: t.status,
        meeting_id: m?.id ?? null,
        meeting_title: m?.title ?? null,
      };
    };
    const completed_tasks = verified.verified_completed.map(toTask);
    const open_tasks = verified.verified_pending.map(toTask).sort((a, b) => {
      const da = a.deadline ? (resolveDeadlineToISODate(a.deadline) ?? "9999") : "9999";
      const db = b.deadline ? (resolveDeadlineToISODate(b.deadline) ?? "9999") : "9999";
      return da.localeCompare(db);
    });

    const discrepancies = verified.conflicts.map((c) => {
      const evidence = c.evidence.map((e) => `${e.source}: ${e.value ?? "none"}`).join(" vs ");
      return evidence ? `${c.description} (${evidence})` : c.description;
    });

    const stats: ProjectSummaryReport["stats"] = {
      meetings: meetings.length,
      completed_meetings: meetings.filter((m) => m.status === "completed").length,
      tasks_total: completed_tasks.length + open_tasks.length,
      tasks_done: completed_tasks.length,
      tasks_open: open_tasks.length,
      decisions: key_decisions.length,
      participants: participantNames,
    };

    const recordedRisks = dedupe(
      (summaries.data ?? []).flatMap((s) => jsonStrings(s.risks)),
      8,
    );
    const recordedFollowUps = (summaries.data ?? []).flatMap((s) => jsonStrings(s.follow_ups));
    const fallbackNextSteps = dedupe(
      [
        ...open_tasks.map((t) => {
          const owner = t.assignee ? ` (${t.assignee}` : " (unassigned";
          const due = t.deadline ? `, due ${safeFormatDeadline(t.deadline)})` : ")";
          return `${t.title}${owner}${due}`;
        }),
        ...recordedFollowUps,
      ],
      10,
    );

    const latest = [...timeline].reverse().find((t) => t.summary);
    const overviewParts = [
      `${project.name} has ${stats.meetings} recorded meeting${stats.meetings === 1 ? "" : "s"} (${stats.completed_meetings} completed), from ${shortDate(meetings[0].date)} to ${shortDate(meetings[meetings.length - 1].date)}.`,
      stats.tasks_total > 0
        ? `${stats.tasks_done} of ${stats.tasks_total} task${stats.tasks_total === 1 ? " is" : "s are"} done and ${stats.tasks_open} remain${stats.tasks_open === 1 ? "s" : ""} open${open_tasks.some((t) => !t.assignee) ? `, ${open_tasks.filter((t) => !t.assignee).length} without an owner` : ""}.`
        : "No tasks have been recorded yet.",
      stats.decisions > 0
        ? `${stats.decisions} decision${stats.decisions === 1 ? " has" : "s have"} been recorded.`
        : "",
      latest ? `Latest summary ("${latest.title}"): ${latest.summary}` : "",
      discrepancies.length > 0
        ? `${discrepancies.length} discrepanc${discrepancies.length === 1 ? "y needs" : "ies need"} checking.`
        : "",
    ];
    const fallbackOverview = overviewParts.filter(Boolean).join(" ");

    const base: ProjectSummaryReport = {
      overview: fallbackOverview,
      progress_report: fallbackOverview,
      stats,
      timeline,
      key_decisions,
      completed_tasks,
      open_tasks,
      risks: recordedRisks,
      next_steps: fallbackNextSteps,
      suggested_agenda: verified.suggested_agenda,
      discrepancies,
      ai_enhanced: false,
      generated_at: new Date().toISOString(),
    };

    const hasRecords =
      timeline.some((t) => t.summary || t.highlights.length) ||
      stats.tasks_total > 0 ||
      stats.decisions > 0;
    if (!hasRecords) return base;

    const records = timeline
      .map((t) => {
        const s = summaryByMeeting.get(t.meeting_id);
        const ds = key_decisions.filter((d) => d.meeting_id === t.meeting_id);
        const lines = [`MEETING "${t.title}" (${shortDate(t.date)}, ${t.status})`];
        lines.push(`Summary: ${t.summary ? t.summary.slice(0, 2000) : "not generated"}`);
        if (t.highlights.length) lines.push(`Key points: ${t.highlights.join(" | ")}`);
        const risks = jsonStrings(s?.risks);
        if (risks.length) lines.push(`Risks: ${risks.join(" | ")}`);
        const follow = jsonStrings(s?.follow_ups);
        if (follow.length) lines.push(`Follow-ups: ${follow.join(" | ")}`);
        if (ds.length) {
          lines.push(
            `Decisions: ${ds.map((d) => `${d.description}${d.made_by ? ` (by ${d.made_by})` : ""}`).join(" | ")}`,
          );
        }
        return lines.join("\n");
      })
      .join("\n\n");

    const tasks = [
      "COMPLETED TASKS:",
      ...(completed_tasks.length ? completed_tasks.map((t) => `- ${taskLine(t)}`) : ["- none"]),
      "",
      "OPEN TASKS:",
      ...(open_tasks.length ? open_tasks.map((t) => `- ${taskLine(t)}`) : ["- none"]),
      "",
      "DISCREPANCIES:",
      ...(discrepancies.length ? discrepancies.map((d) => `- ${d}`) : ["- none"]),
    ].join("\n");

    const facts = [
      `Meetings: ${stats.meetings} (${stats.completed_meetings} completed)`,
      `Tasks: ${stats.tasks_total} total, ${stats.tasks_done} done, ${stats.tasks_open} open`,
      `Decisions: ${stats.decisions}`,
      `Participants: ${participantNames.join(", ") || "not recorded"}`,
      `Today: ${shortDate(new Date().toISOString())}`,
    ].join("\n");

    try {
      const res = await generateForUser(supabase, userId, "generateProjectSummary", {
        contents: [
          {
            role: "user",
            parts: [{ text: projectPrompt({ projectName: project.name, facts, records, tasks }) }],
          },
        ],
        config: {
          systemInstruction: PROJECT_SYSTEM,
          responseMimeType: "application/json",
          responseSchema: PROJECT_SCHEMA,
          temperature: 0.2,
        },
      });
      const parsed = parseAi(aiProjectReport, res.text);
      if (!parsed.overview) return base;
      return {
        ...base,
        overview: parsed.overview,
        progress_report: parsed.overview,
        risks: parsed.risks.length ? dedupe(parsed.risks, 8) : base.risks,
        next_steps: parsed.next_steps.length ? dedupe(parsed.next_steps, 10) : base.next_steps,
        suggested_agenda: parsed.suggested_agenda.length
          ? dedupe(parsed.suggested_agenda, 6)
          : base.suggested_agenda,
        ai_enhanced: true,
      };
    } catch (err) {
      console.warn("[ai] project summary fell back to the verified report:", err);
      return base;
    }
  });

const ChatInput = z.object({ message: str(4000).min(1, "Message is empty") });
const CHAT_HISTORY_LIMIT = 20;

export const askChatBot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: z.input<typeof ChatInput>) => parseInput(ChatInput, input))
  .handler(async ({ data, context }): Promise<{ reply: string }> => {
    const { supabase, userId } = context;

    const [historyRes, meetingsRes] = await Promise.all([
      supabase
        .from("chat_messages")
        .select("role, content, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(CHAT_HISTORY_LIMIT),
      supabase
        .from("meetings")
        .select("id, title, scheduled_at, created_at, status")
        .eq("host_id", userId)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    if (historyRes.error)
      fail("load chat history", historyRes.error, "Could not load your chat history.");
    if (meetingsRes.error)
      fail("load meetings", meetingsRes.error, "Could not load your meetings.");

    const meetings = meetingsRes.data ?? [];
    const ids = meetings.map((m) => m.id);
    const [summaries, decisions, ownTasks, assignedTasks] = await Promise.all([
      ids.length
        ? supabase
            .from("ai_summaries")
            .select("meeting_id, executive_summary")
            .in("meeting_id", ids)
        : Promise.resolve({ data: [], error: null }),
      ids.length
        ? supabase.from("decisions").select("meeting_id, description").in("meeting_id", ids)
        : Promise.resolve({ data: [], error: null }),
      ids.length
        ? supabase
            .from("action_items")
            .select("meeting_id, title, assignee, deadline, status")
            .in("meeting_id", ids)
            .neq("status", "done")
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("action_items")
        .select("meeting_id, title, assignee, deadline, status")
        .eq("assignee_user_id", userId)
        .neq("status", "done"),
    ]);
    for (const r of [summaries, decisions, ownTasks, assignedTasks]) {
      if (r.error) fail("load chat context", r.error, "Could not load your meeting records.");
    }

    let ctx = "";
    for (const m of meetings) {
      ctx += `MEETING: "${m.title}" (${m.status}, ${m.scheduled_at ?? m.created_at})\n`;
      const s = (summaries.data ?? []).find((x) => x.meeting_id === m.id);
      if (s?.executive_summary) ctx += `Summary: ${s.executive_summary}\n`;
      const ds = (decisions.data ?? []).filter((d) => d.meeting_id === m.id);
      if (ds.length) ctx += `Decisions: ${ds.map((d) => d.description).join(" | ")}\n`;
      ctx += "\n";
    }
    const open = new Map<
      string,
      { title: string; assignee: string | null; deadline: string | null; status: string }
    >();
    for (const t of [...(ownTasks.data ?? []), ...(assignedTasks.data ?? [])]) {
      open.set(`${t.meeting_id}:${t.title}`, t);
    }
    if (open.size) {
      ctx += "OPEN TASKS:\n";
      for (const t of open.values()) {
        ctx += `- ${t.title} (${t.status}; assigned to ${t.assignee ?? "nobody"}; due ${t.deadline ?? "not set"})\n`;
      }
    }
    if (!ctx.trim()) ctx = "The user has no meetings or tasks yet.";

    const history = (historyRes.data ?? []).reverse().map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const res = await generateForUser(supabase, userId, "askChatBot", {
      contents: [...history, { role: "user", parts: [{ text: data.message }] }],
      config: { systemInstruction: chatSystem(ctx), temperature: 0.4 },
    });
    const reply = res.text.trim();
    if (!reply) throw new Error("The AI returned an empty reply. Please try again.");

    const now = Date.now();
    const { error: saveErr } = await supabase.from("chat_messages").insert([
      {
        user_id: userId,
        role: "user",
        content: data.message,
        created_at: new Date(now).toISOString(),
      },
      {
        user_id: userId,
        role: "assistant",
        content: reply.slice(0, 20000),
        created_at: new Date(now + 1).toISOString(),
      },
    ]);
    if (saveErr) fail("save chat", saveErr, "Could not save the conversation.");

    return { reply };
  });

const AUDIO_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
];

const TranscribeInput = z.object({
  meetingId: uuid,
  base64Audio: base64Field(MAX_AUDIO_BYTES, "Audio clip"),
  segmentIndex: z.number().int().min(0).max(1_000_000),
  screenshotBase64: base64Field(MAX_SCREENSHOT_BYTES, "Screenshot").optional(),
  knownParticipants: z.array(str(100)).max(50).optional(),

  hostName: z.string().max(200).optional(),
});

const REMOTE_PARTICIPANT_LABEL = "Remote Participant";
const PLACEHOLDER_SPEAKERS = new Set([
  "remote",
  "remote participant",
  "remote speaker",
  "unknown",
  "unknown speaker",
  "speaker",
  "participant",
]);
const SELF_SPEAKERS = new Set(["you", "host", "me"]);

function isPlaceholderSpeaker(name: string | null | undefined): boolean {
  return PLACEHOLDER_SPEAKERS.has((name ?? "").trim().toLowerCase());
}

type Client = Parameters<typeof requireOwnedMeeting>[0];

async function relabelPlaceholderLines(
  supabase: Client,
  meetingId: string,
  name: string,
): Promise<number> {
  const { data: rows, error } = await supabase
    .from("transcripts")
    .select("id, speaker")
    .eq("meeting_id", meetingId);
  if (error) fail("load transcript speakers", error, "Could not update the transcript speakers.");
  const ids = (rows ?? []).filter((r) => isPlaceholderSpeaker(r.speaker)).map((r) => r.id);
  if (ids.length === 0) return 0;
  const { error: upErr } = await supabase
    .from("transcripts")
    .update({ speaker: name })
    .in("id", ids);
  if (upErr) fail("relabel transcript", upErr, "Could not update the transcript speakers.");
  return ids.length;
}

export type RemoteTranscription = {
  segments: Array<{
    meeting_id: string;
    speaker: string;
    content: string;
    segment_index: number;
    spoken_at: string;
    status: "partial";
  }>;
  renamed: { from: string; to: string } | null;
};

export const transcribeRemoteAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: z.input<typeof TranscribeInput>) => parseInput(TranscribeInput, input))
  .handler(async ({ data, context }): Promise<RemoteTranscription | null> => {
    const { supabase, userId } = context;
    const meeting = await requireOwnedMeeting(supabase, userId, data.meetingId);
    const [hostName, existingNames] = await Promise.all([
      getHostName(supabase, userId),
      getParticipantNames(supabase, meeting.id),
    ]);

    const audio = splitBase64(data.base64Audio);
    const audioType =
      audio.mimeType && AUDIO_TYPES.includes(audio.mimeType) ? audio.mimeType : "audio/webm";
    const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
      { inlineData: { data: audio.data, mimeType: audioType } },
    ];
    if (data.screenshotBase64) {
      const shot = splitBase64(data.screenshotBase64);
      parts.push({ inlineData: { data: shot.data, mimeType: shot.mimeType ?? "image/jpeg" } });
    }
    parts.push({ text: "Transcribe the spoken audio and identify the speakers." });

    const participants = Array.from(new Set([...existingNames, ...(data.knownParticipants ?? [])]));
    const res = await generateForUser(supabase, userId, "transcribeRemoteAudio", {
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: transcribeSystem({ hostName, participants }),
        responseMimeType: "application/json",
        responseSchema: TRANSCRIBE_SCHEMA,
        temperature: 0,
      },
    });

    const parsed = parseAi(
      z.array(z.object({ speaker: z.string().nullish(), text: z.string().nullish() })),
      res.text || "[]",
    );
    const segments = parsed
      .map((s) => ({
        speaker: (s.speaker ?? "").trim().slice(0, 100) || REMOTE_PARTICIPANT_LABEL,
        content: (s.text ?? "").trim().slice(0, 5000),
      }))
      .filter((s) => s.content.length > 1);
    if (segments.length === 0) return null;

    const isHostName = (name: string) => name.toLowerCase() === hostName.toLowerCase();
    const known = new Set(existingNames.map((n) => n.toLowerCase()));
    const newNames: string[] = [];
    for (const s of segments) {
      const key = s.speaker.toLowerCase();
      if (!known.has(key) && !PLACEHOLDER_SPEAKERS.has(key) && !SELF_SPEAKERS.has(key)) {
        known.add(key);
        newNames.push(s.speaker);
      }
    }

    let renamed: RemoteTranscription["renamed"] = null;
    const firstRemote = newNames.find((n) => !isHostName(n));
    if (firstRemote) {
      const { data: rows, error: pErr } = await supabase
        .from("participants")
        .select("id, name")
        .eq("meeting_id", meeting.id);
      if (pErr) fail("load participants", pErr, "Could not load the meeting participants.");
      const generic = (rows ?? []).find((p) => isPlaceholderSpeaker(p.name));
      const realRemotes = (rows ?? []).filter(
        (p) => !isPlaceholderSpeaker(p.name) && !isHostName(p.name),
      );
      if (generic) {
        const { error } = await supabase
          .from("participants")
          .update({ name: firstRemote, role: "participant" })
          .eq("id", generic.id);
        if (error) fail("rename participant", error, "Could not rename the remote participant.");
        await relabelPlaceholderLines(supabase, meeting.id, firstRemote);
        renamed = { from: generic.name, to: firstRemote };
        newNames.splice(newNames.indexOf(firstRemote), 1);
      } else if (realRemotes.length === 0) {
        const count = await relabelPlaceholderLines(supabase, meeting.id, firstRemote);
        if (count > 0) renamed = { from: REMOTE_PARTICIPANT_LABEL, to: firstRemote };
      }
    }

    if (newNames.length > 0) {
      const { error } = await supabase.from("participants").insert(
        newNames.map((name) => ({
          meeting_id: meeting.id,
          name,
          role: isHostName(name) ? "host" : "participant",
        })),
      );
      if (error) fail("add participants", error, "Could not save the new participants.");
    }

    const spokenAt = new Date().toISOString();
    return {
      renamed,
      segments: segments.map((s) => ({
        meeting_id: meeting.id,
        speaker: renamed && isPlaceholderSpeaker(s.speaker) ? renamed.to : s.speaker,
        content: s.content,
        segment_index: data.segmentIndex,
        spoken_at: spokenAt,
        status: "partial" as const,
      })),
    };
  });

const CleanInput = z.object({
  meetingId: uuid,
  rawText: z.string().max(200_000, "Transcript text is too long").optional(),
});

export const cleanAndAlignTranscripts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: z.input<typeof CleanInput>) => parseInput(CleanInput, input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const meeting = await requireOwnedMeeting(supabase, userId, data.meetingId);

    const { data: oldSegs, error: segErr } = await supabase
      .from("transcripts")
      .select("id, speaker, content, spoken_at")
      .eq("meeting_id", meeting.id)
      .order("segment_index", { ascending: true });
    if (segErr) fail("load transcript", segErr, "Could not load the transcript.");

    const raw = data.rawText?.trim() ? data.rawText : transcriptText(oldSegs);
    if (!raw.trim()) throw new Error("There is no transcript text to clean.");

    const [hostName, participants] = await Promise.all([
      getHostName(supabase, userId),
      getParticipantNames(supabase, meeting.id),
    ]);

    const res = await generateForUser(supabase, userId, "cleanAndAlignTranscripts", {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: cleanPrompt({ title: meeting.title, hostName, participants, transcript: raw }),
            },
          ],
        },
      ],
      config: {
        systemInstruction: CLEAN_SYSTEM,
        responseMimeType: "application/json",
        responseSchema: CLEAN_SCHEMA,
        temperature: 0.1,
      },
    });
    const parsed = parseAi(
      z.object({
        cleaned_transcripts: z.array(z.object({ speaker: z.string(), content: z.string() })),
      }),
      res.text,
    );
    const cleaned = parsed.cleaned_transcripts
      .map((c) => ({ speaker: c.speaker.trim().slice(0, 100), content: c.content.trim() }))
      .filter((c) => c.speaker && c.content);
    if (cleaned.length === 0) {
      throw new Error(
        "The AI could not produce a cleaned transcript. Your original transcript was kept.",
      );
    }

    const old = oldSegs ?? [];
    const now = new Date().toISOString();
    const toInsert = cleaned.map((c, i) => ({
      meeting_id: meeting.id,
      speaker: c.speaker,
      content: c.content,
      segment_index: i,
      spoken_at: old.length ? old[Math.floor((i * old.length) / cleaned.length)].spoken_at : now,
    }));

    const { data: inserted, error: insErr } = await supabase
      .from("transcripts")
      .insert(toInsert)
      .select("*");
    if (insErr) fail("insert cleaned transcript", insErr, "Could not save the cleaned transcript.");

    if (old.length > 0) {
      const { error: delErr } = await supabase
        .from("transcripts")
        .delete()
        .in(
          "id",
          old.map((s) => s.id),
        );
      if (delErr) {
        await supabase
          .from("transcripts")
          .delete()
          .in(
            "id",
            (inserted ?? []).map((s) => s.id),
          );
        fail(
          "replace transcript",
          delErr,
          "Could not replace the transcript. Your original was kept.",
        );
      }
    }

    const knownNames = new Set(participants.map((n) => n.toLowerCase()));
    const addedSpeakers: string[] = [];
    for (const c of cleaned) {
      const key = c.speaker.toLowerCase();
      if (knownNames.has(key) || PLACEHOLDER_SPEAKERS.has(key) || SELF_SPEAKERS.has(key)) continue;
      knownNames.add(key);
      addedSpeakers.push(c.speaker);
    }
    if (addedSpeakers.length > 0) {
      const { error: pErr } = await supabase.from("participants").insert(
        addedSpeakers.map((name) => ({
          meeting_id: meeting.id,
          name,
          role: name.toLowerCase() === hostName.toLowerCase() ? "host" : "participant",
        })),
      );
      if (pErr) console.error("[db] add transcript speakers:", pErr.message);
    }

    return { success: true as const, transcripts: inserted ?? [], addedSpeakers };
  });

const statusSchema = z.preprocess(
  (v) => (v === "completed" ? "done" : v),
  z.enum(["pending", "in_progress", "done"]),
);

const UpdateStatusInput = z.object({ actionId: uuid, status: statusSchema });

export const updateActionItemStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: z.input<typeof UpdateStatusInput>) => parseInput(UpdateStatusInput, input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("action_items")
      .update({ status: data.status })
      .eq("id", data.actionId)
      .select("id");
    if (error) fail("update task status", error, "Could not update the task.");
    if (!rows || rows.length === 0) {
      throw new Error("Task not found, or you are not allowed to change it.");
    }
    return { success: true as const };
  });

const ActionIdInput = z.object({ actionId: uuid });

export const deleteActionItemServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: z.input<typeof ActionIdInput>) => parseInput(ActionIdInput, input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("action_items")
      .delete()
      .eq("id", data.actionId)
      .select("id");
    if (error) fail("delete task", error, "Could not delete the task.");
    if (!rows || rows.length === 0) {
      throw new Error("Task not found, or only the meeting host can delete it.");
    }
    return { success: true as const };
  });

export type TodoTask = ActionItemRow & { meeting_title: string | null; is_host: boolean };

const NoInput = z.union([z.undefined(), z.null(), z.object({}).strict()]);

export const fetchUserTodoTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input?: z.input<typeof NoInput>) => parseInput(NoInput, input))
  .handler(async ({ context }): Promise<TodoTask[]> => {
    const { supabase, userId } = context;

    const { data: meetings, error: mErr } = await supabase
      .from("meetings")
      .select("id, title")
      .eq("host_id", userId);
    if (mErr) fail("load meetings", mErr, "Could not load your meetings.");
    const titles = new Map((meetings ?? []).map((m) => [m.id, m.title]));

    const [own, assigned] = await Promise.all([
      supabase
        .from("action_items")
        .select("*, meetings!inner(host_id)")
        .eq("meetings.host_id", userId),
      supabase.from("action_items").select("*").eq("assignee_user_id", userId),
    ]);
    if (own.error) fail("load tasks", own.error, "Could not load your tasks.");
    if (assigned.error) fail("load assigned tasks", assigned.error, "Could not load your tasks.");

    const byId = new Map<string, TodoTask>();
    const ownRows = (own.data ?? []).map(({ meetings: _meeting, ...row }) => row);
    for (const t of [...ownRows, ...(assigned.data ?? [])]) {
      byId.set(t.id, {
        ...t,
        meeting_title: titles.get(t.meeting_id) ?? null,
        is_host: titles.has(t.meeting_id),
      });
    }
    return Array.from(byId.values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
  });

const CreateActionInput = z.object({
  id: z.string().max(100).optional(),
  title: str(500).min(1, "Title is required"),
  assignee: str(200).nullish(),
  meetingId: uuid,
  deadline: str(64).nullish(),
  status: statusSchema.optional(),
});

export const createActionItemServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: z.input<typeof CreateActionInput>) => parseInput(CreateActionInput, input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireOwnedMeeting(supabase, userId, data.meetingId);

    let deadline: string | null = null;
    if (data.deadline) {
      deadline = resolveDeadlineToISODate(data.deadline, new Date());
      if (!deadline) throw new Error("The deadline is not a valid date.");
    }

    const assignee =
      data.assignee && SELF_SPEAKERS.has(data.assignee.toLowerCase())
        ? await getHostName(supabase, userId)
        : data.assignee || null;

    const { data: task, error } = await supabase
      .from("action_items")
      .insert({
        meeting_id: data.meetingId,
        title: data.title,
        assignee,
        deadline,
        status: data.status ?? "pending",
      })
      .select("*")
      .single();
    if (error) fail("create task", error, "Could not create the task.");
    return { success: true as const, task };
  });

export const reconcileProjectTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input?: z.input<typeof NoInput>) => parseInput(NoInput, input))
  .handler(async ({ context }): Promise<TaskProgressResult> =>
    reconcileTaskProgress(context.supabase, context.userId),
  );
