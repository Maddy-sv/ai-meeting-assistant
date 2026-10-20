import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildVerifiedCumulativeSummary, resolveDeadlineToISODate } from "./continuous-memory";
import { parseJson } from "@/server/ai/gemini";
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
  replaceDecisions,
  requireOwnedMeeting,
  saveExtractedActionItems,
  type ActionItemRow,
  type DecisionRow,
} from "@/server/meetings";

// ---------------------------------------------------------------------------
// Shared schemas for AI output
// ---------------------------------------------------------------------------

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

const aiExtraction = z.object({
  action_items: z
    .array(aiActionItem)
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

type SummaryPayload = {
  executive_summary: string;
  key_points: string[];
  risks: string[];
  follow_ups: string[];
  action_items: { title: string; assignee: string | null; deadline: string | null }[];
  decisions: { description: string; made_by: string | null }[];
};

// ---------------------------------------------------------------------------
// summarizeMeeting
// ---------------------------------------------------------------------------

const SummarizeInput = z.object({
  meetingId: uuid,
  screenshots: z
    .array(base64Field(MAX_SCREENSHOT_BYTES, "Screenshot"))
    .max(MAX_SCREENSHOTS, `At most ${MAX_SCREENSHOTS} screenshots can be attached`)
    .optional(),
});

export const summarizeMeeting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof SummarizeInput>) => parseInput(SummarizeInput, input))
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

    const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
      { text: summaryPrompt({ title: meeting.title, hostName, participants, transcript }) },
    ];
    for (const shot of data.screenshots ?? []) {
      const { mimeType, data: b64 } = splitBase64(shot);
      parts.push({ inlineData: { data: b64, mimeType: mimeType ?? "image/jpeg" } });
    }

    const res = await generateForUser(supabase, userId, "summarizeMeeting", {
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: SUMMARY_SYSTEM,
        responseMimeType: "application/json",
        responseSchema: SUMMARY_SCHEMA,
        temperature: 0.2,
      },
    });
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

    const savedItems = await saveExtractedActionItems(supabase, meeting, parsed.action_items, {
      hostName,
    });
    await replaceDecisions(supabase, meeting.id, parsed.decisions);

    const { error: notifErr } = await supabase.from("notifications").insert({
      user_id: userId,
      type: "summary_ready",
      title: `Summary ready: ${meeting.title}`.slice(0, 200),
      body: parsed.executive_summary.slice(0, 280),
      link: `/meetings/${meeting.id}`,
    });
    // The summary itself is saved; a missing notification is logged, not fatal.
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

// ---------------------------------------------------------------------------
// syncMeetingActionItems
// ---------------------------------------------------------------------------

const MeetingIdInput = z.object({ meetingId: uuid });

export const syncMeetingActionItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof MeetingIdInput>) => parseInput(MeetingIdInput, input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ action_items: ActionItemRow[]; decisions: DecisionRow[] }> => {
      const { supabase, userId } = context;
      const meeting = await requireOwnedMeeting(supabase, userId, data.meetingId);

      const [hostName, segsRes, summaryRes] = await Promise.all([
        getHostName(supabase, userId),
        supabase
          .from("transcripts")
          .select("speaker, content")
          .eq("meeting_id", meeting.id)
          .order("segment_index", { ascending: true }),
        supabase
          .from("ai_summaries")
          .select("executive_summary, key_points")
          .eq("meeting_id", meeting.id)
          .maybeSingle(),
      ]);
      if (segsRes.error) fail("load transcript", segsRes.error, "Could not load the transcript.");
      if (summaryRes.error) fail("load summary", summaryRes.error, "Could not load the summary.");

      const transcript = transcriptText(segsRes.data);
      const summary = summaryRes.data?.executive_summary ?? "";
      const keyPoints = Array.isArray(summaryRes.data?.key_points)
        ? (summaryRes.data.key_points as unknown[]).filter(
            (k): k is string => typeof k === "string",
          )
        : [];
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

      const action_items = await saveExtractedActionItems(supabase, meeting, parsed.action_items, {
        hostName,
        evidenceText: `${transcript}\n${summary}\n${keyPoints.join("\n")}`,
      });
      const decisions = await replaceDecisions(supabase, meeting.id, parsed.decisions);
      return { action_items, decisions };
    },
  );

// ---------------------------------------------------------------------------
// generateMeetingRecaps (no AI call: composes recap emails from saved data)
// ---------------------------------------------------------------------------

function assigneeNames(assignee: string | null): string[] {
  return (assignee ?? "")
    .split(/,|&|\band\b/i)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const generateMeetingRecaps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof MeetingIdInput>) => parseInput(MeetingIdInput, input))
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
      const mine = actions.filter((a) => assigneeNames(a.assignee).includes(name.toLowerCase()));
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

// ---------------------------------------------------------------------------
// generateProjectSummary
// ---------------------------------------------------------------------------

const ProjectInput = z.object({ projectId: uuid });

export const generateProjectSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof ProjectInput>) => parseInput(ProjectInput, input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: project, error: pErr } = await supabase
      .from("projects")
      .select("id, name, owner_id")
      .eq("id", data.projectId)
      .maybeSingle();
    if (pErr) fail("load project", pErr, "Could not load the project.");
    if (!project || project.owner_id !== userId) throw new Error("Project not found.");

    const { data: meetings, error: mErr } = await supabase
      .from("meetings")
      .select("id, title, scheduled_at, created_at")
      .eq("project_id", project.id)
      .eq("host_id", userId)
      .order("scheduled_at", { ascending: true, nullsFirst: false });
    if (mErr) fail("load project meetings", mErr, "Could not load the project's meetings.");

    if (!meetings || meetings.length === 0) {
      return {
        progress_report: "No meetings found for this project yet.",
        suggested_agenda: [] as string[],
        verified_completed: [],
        verified_pending: [],
        verified_decisions: [],
        conflicts: [],
        ai_enhanced: false,
      };
    }

    const ids = meetings.map((m) => m.id);
    const [summaries, actions, decisions, transcripts, participants] = await Promise.all([
      supabase
        .from("ai_summaries")
        .select("meeting_id, executive_summary, key_points")
        .in("meeting_id", ids),
      supabase.from("action_items").select("*").in("meeting_id", ids),
      supabase.from("decisions").select("*").in("meeting_id", ids),
      supabase.from("transcripts").select("meeting_id, speaker, content").in("meeting_id", ids),
      supabase.from("participants").select("name").in("meeting_id", ids),
    ]);
    for (const r of [summaries, actions, decisions, transcripts, participants]) {
      if (r.error) fail("load project records", r.error, "Could not load the project's records.");
    }

    const verified = buildVerifiedCumulativeSummary(
      { id: project.id, name: project.name },
      meetings.map((m) => ({ ...m, scheduled_at: m.scheduled_at ?? m.created_at })),
      summaries.data ?? [],
      actions.data ?? [],
      decisions.data ?? [],
      transcripts.data ?? [],
      (participants.data ?? []).map((p) => p.name),
    );

    const base = {
      progress_report: verified.progress_report,
      suggested_agenda: verified.suggested_agenda,
      verified_completed: verified.verified_completed,
      verified_pending: verified.verified_pending,
      verified_decisions: verified.verified_decisions,
      conflicts: verified.conflicts,
    };

    const res = await generateForUser(supabase, userId, "generateProjectSummary", {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: projectPrompt({
                verifiedReport: verified.progress_report,
                pending:
                  verified.verified_pending
                    .map(
                      (t) =>
                        `- [${t.status}] ${t.title} (${t.assignee ?? "unassigned"}, due ${t.deadline ?? "not set"})`,
                    )
                    .join("\n") || "None",
              }),
            },
          ],
        },
      ],
      config: {
        systemInstruction: PROJECT_SYSTEM,
        responseMimeType: "application/json",
        responseSchema: PROJECT_SCHEMA,
        temperature: 0.2,
      },
    });
    const parsed = parseAi(
      z.object({
        progress_report: z.string().trim(),
        suggested_agenda: strList(5),
      }),
      res.text,
    );
    if (!parsed.progress_report) {
      throw new Error("The AI returned an empty project summary. Please try again.");
    }

    return {
      ...base,
      progress_report: parsed.progress_report,
      suggested_agenda: parsed.suggested_agenda.length
        ? parsed.suggested_agenda
        : base.suggested_agenda,
      ai_enhanced: true,
    };
  });

// ---------------------------------------------------------------------------
// askChatBot
// ---------------------------------------------------------------------------

const ChatInput = z.object({ message: str(4000).min(1, "Message is empty") });
const CHAT_HISTORY_LIMIT = 20;

export const askChatBot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof ChatInput>) => parseInput(ChatInput, input))
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

// ---------------------------------------------------------------------------
// transcribeRemoteAudio
// ---------------------------------------------------------------------------

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
  /** Ignored: the host name always comes from the caller's profile. */
  hostName: z.string().max(200).optional(),
});

const PLACEHOLDER_SPEAKERS = new Set(["remote", "remote participant", "unknown", "speaker"]);

export const transcribeRemoteAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof TranscribeInput>) => parseInput(TranscribeInput, input))
  .handler(async ({ data, context }) => {
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
        speaker: (s.speaker ?? "").trim().slice(0, 100) || "Remote Participant",
        content: (s.text ?? "").trim().slice(0, 5000),
      }))
      .filter((s) => s.content.length > 1);
    if (segments.length === 0) return null;

    // Register newly identified named speakers as participants.
    const known = new Set(existingNames.map((n) => n.toLowerCase()));
    const newNames: string[] = [];
    for (const s of segments) {
      const key = s.speaker.toLowerCase();
      if (!known.has(key) && !PLACEHOLDER_SPEAKERS.has(key)) {
        known.add(key);
        newNames.push(s.speaker);
      }
    }
    if (newNames.length > 0) {
      const { error } = await supabase.from("participants").insert(
        newNames.map((name) => ({
          meeting_id: meeting.id,
          name,
          role: name.toLowerCase() === hostName.toLowerCase() ? "host" : "participant",
        })),
      );
      if (error) fail("add participants", error, "Could not save the new participants.");
    }

    const spokenAt = new Date().toISOString();
    return segments.map((s) => ({
      meeting_id: meeting.id,
      speaker: s.speaker,
      content: s.content,
      segment_index: data.segmentIndex,
      spoken_at: spokenAt,
      status: "partial" as const,
    }));
  });

// ---------------------------------------------------------------------------
// cleanAndAlignTranscripts
// ---------------------------------------------------------------------------

const CleanInput = z.object({
  meetingId: uuid,
  rawText: z.string().max(200_000, "Transcript text is too long").optional(),
});

export const cleanAndAlignTranscripts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof CleanInput>) => parseInput(CleanInput, input))
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

    // Keep the original timing: map each cleaned line onto the old timeline.
    const old = oldSegs ?? [];
    const now = new Date().toISOString();
    const toInsert = cleaned.map((c, i) => ({
      meeting_id: meeting.id,
      speaker: c.speaker,
      content: c.content,
      segment_index: i,
      spoken_at: old.length ? old[Math.floor((i * old.length) / cleaned.length)].spoken_at : now,
    }));

    // Insert the new transcript first, then remove the old rows by id.
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

    return { success: true as const, transcripts: inserted ?? [] };
  });

// ---------------------------------------------------------------------------
// Action item CRUD
// ---------------------------------------------------------------------------

const statusSchema = z.preprocess(
  (v) => (v === "completed" ? "done" : v),
  z.enum(["pending", "in_progress", "done"]),
);

const UpdateStatusInput = z.object({ actionId: uuid, status: statusSchema });

export const updateActionItemStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof UpdateStatusInput>) =>
    parseInput(UpdateStatusInput, input),
  )
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
  .inputValidator((input: z.input<typeof ActionIdInput>) => parseInput(ActionIdInput, input))
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

/** Tasks from the caller's own meetings plus tasks assigned to the caller. */
export const fetchUserTodoTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: z.input<typeof NoInput>) => parseInput(NoInput, input))
  .handler(async ({ context }): Promise<TodoTask[]> => {
    const { supabase, userId } = context;

    const { data: meetings, error: mErr } = await supabase
      .from("meetings")
      .select("id, title")
      .eq("host_id", userId);
    if (mErr) fail("load meetings", mErr, "Could not load your meetings.");
    const titles = new Map((meetings ?? []).map((m) => [m.id, m.title]));
    const ids = Array.from(titles.keys());

    const [own, assigned] = await Promise.all([
      ids.length
        ? supabase.from("action_items").select("*").in("meeting_id", ids)
        : Promise.resolve({ data: [] as ActionItemRow[], error: null }),
      supabase.from("action_items").select("*").eq("assignee_user_id", userId),
    ]);
    if (own.error) fail("load tasks", own.error, "Could not load your tasks.");
    if (assigned.error) fail("load assigned tasks", assigned.error, "Could not load your tasks.");

    const byId = new Map<string, TodoTask>();
    for (const t of [...(own.data ?? []), ...(assigned.data ?? [])]) {
      byId.set(t.id, {
        ...t,
        meeting_title: titles.get(t.meeting_id) ?? null,
        is_host: titles.has(t.meeting_id),
      });
    }
    return Array.from(byId.values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
  });

const CreateActionInput = z.object({
  /** Ignored: the database generates the id. */
  id: z.string().max(100).optional(),
  title: str(500).min(1, "Title is required"),
  assignee: str(200).nullish(),
  meetingId: uuid,
  deadline: str(64).nullish(),
  status: statusSchema.optional(),
});

export const createActionItemServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof CreateActionInput>) =>
    parseInput(CreateActionInput, input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireOwnedMeeting(supabase, userId, data.meetingId);

    let deadline: string | null = null;
    if (data.deadline) {
      deadline = resolveDeadlineToISODate(data.deadline, new Date());
      if (!deadline) throw new Error("The deadline is not a valid date.");
    }

    const { data: task, error } = await supabase
      .from("action_items")
      .insert({
        meeting_id: data.meetingId,
        title: data.title,
        assignee: data.assignee || null,
        deadline,
        status: data.status ?? "pending",
      })
      .select("*")
      .single();
    if (error) fail("create task", error, "Could not create the task.");
    return { success: true as const, task };
  });
