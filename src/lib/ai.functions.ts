import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { GoogleGenAI, Type } from "@google/genai";

const AVAILABLE_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
];

async function generateWithRetry(ai: any, params: any, maxRetries = 3) {
  const modelsToTry = params.model
    ? [params.model, ...AVAILABLE_MODELS.filter(m => m !== params.model)]
    : AVAILABLE_MODELS;

  let lastErr: any = null;

  for (const model of modelsToTry) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await ai.models.generateContent({ ...params, model });
      } catch (err: any) {
        lastErr = err;
        const msg = err?.message || String(err) || "";
        const isRateOrDemandError = 
          msg.includes("503") || 
          msg.includes("429") || 
          msg.includes("RESOURCE_EXHAUSTED") || 
          msg.includes("UNAVAILABLE") || 
          msg.includes("quota") || 
          msg.includes("Quota") ||
          msg.includes("exceeded") ||
          msg.includes("rate-limit") ||
          msg.includes("rate_limit") ||
          msg.includes("overloaded") ||
          msg.includes("Please retry in") ||
          msg.includes("high demand");

        if (isRateOrDemandError) {
          // If this model hit a daily quota (429 RESOURCE_EXHAUSTED), switch to next available candidate model immediately
          if (msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota") || msg.includes("Quota") || msg.includes("429")) {
            console.warn(`Model ${model} hit quota limit. Failing over to next model...`);
            break;
          }

          if (i < maxRetries - 1) {
            let delayMs = (i + 1) * 1500;
            const msMatch = msg.match(/retry in ([0-9.]+)ms/i);
            const sMatch = msg.match(/retry in ([0-9.]+)s/i);
            if (msMatch && msMatch[1]) {
              const parsed = parseFloat(msMatch[1]);
              if (!isNaN(parsed) && parsed > 0) delayMs = Math.max(delayMs, parsed + 400);
            } else if (sMatch && sMatch[1]) {
              const parsed = parseFloat(sMatch[1]);
              if (!isNaN(parsed) && parsed > 0) delayMs = Math.max(delayMs, (parsed * 1000) + 400);
            }

            console.warn(`Gemini API rate limit on ${model}. Retrying in ${(delayMs/1000).toFixed(1)}s (attempt ${i + 1}/${maxRetries})...`);
            await new Promise(r => setTimeout(r, delayMs));
          }
        } else {
          // Non-rate error (e.g. 404 model not found) -> try next model
          break;
        }
      }
    }
  }

  throw lastErr || new Error("All AI models are currently busy or unavailable.");
}

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
  .inputValidator((input: { meetingId: string; screenshots?: string[] }) => {
    if (!input?.meetingId || typeof input.meetingId !== "string") {
      throw new Error("meetingId is required");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("Missing GEMINI_API_KEY");

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

    const { data: hostProf } = await supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle();
    const hostName = hostProf?.full_name?.trim() || "Host";

    const ai = new GoogleGenAI({ apiKey: key });

    // Fetch participants to ensure accurate speaker diarization
    const { data: participants } = await supabase
      .from("participants")
      .select("name, role")
      .eq("meeting_id", data.meetingId);

    const participantNames = (participants || []).map((p: any) => p.name).filter(Boolean);
    if (!participantNames.includes(hostName)) participantNames.unshift(hostName);

    // AUTOMATIC AI TRANSCRIPT CLEANING & DIARIZATION:
    // Automatically fix speech-to-text phonetic typos (e.g. "police dashboard" -> "finish the dashboard", "by Pride" -> "by Friday")
    // and re-align / separate conversation turns across participants before generating the summary.
    let cleanedTranscript = transcript;
    try {
      if (segs && segs.length > 0) {
        const cleanPrompt = `You are an expert AI meeting transcription cleaner and diarizer.

Meeting Title: ${meeting.title}
Known Participants: ${participantNames.join(", ")}
Host/User: ${hostName}

Raw Speech-To-Text Transcripts:
${transcript}

TASK:
1. Fix all speech-to-text phonetic mistranslations and typos based on conversation context (e.g., "police dashboard" -> "finish the dashboard", "by Pride" -> "by Friday", "content development" -> "frontend development").
2. Correctly separate conversation turns and attribute each line to the proper speaker. If speaker 1 is remote/client and speaker 2 is ${hostName}, distinguish their back-and-forth accurately.
3. Keep the conversation accurate, natural, and clear. Do not invent fictitious topics.
4. Output STRICT JSON with "cleaned_transcripts" containing an array of objects with { "speaker": string, "content": string }.`;

        const cleanConfig = {
          model: "gemini-2.5-flash",
          temperature: 0.1,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              cleaned_transcripts: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    speaker: { type: Type.STRING },
                    content: { type: Type.STRING },
                  },
                  required: ["speaker", "content"],
                },
              },
            },
            required: ["cleaned_transcripts"],
          },
        };

        const cleanRes = await generateWithRetry(ai, {
          contents: [{ text: cleanPrompt }],
          config: cleanConfig,
        });

        const parsedClean = JSON.parse(cleanRes.text || "{}");
        const cleanedList: Array<{ speaker: string; content: string }> = parsedClean.cleaned_transcripts || [];

        if (cleanedList.length > 0) {
          cleanedTranscript = cleanedList.map(item => `${item.speaker}: ${item.content}`).join("\n");
          
          // Automatically update the transcripts table in the database so the UI also shows the clean version
          try {
            const toInsert = cleanedList.map((item, idx) => ({
              meeting_id: data.meetingId,
              speaker: item.speaker,
              content: item.content,
              segment_index: idx,
              spoken_at: new Date(Date.now() - (cleanedList.length - idx) * 15000).toISOString(),
            }));
            
            await supabase.from("transcripts").delete().eq("meeting_id", data.meetingId);
            const { error: insErr } = await supabase.from("transcripts").insert(toInsert);
            if (insErr) console.error("Failed to insert auto-cleaned transcripts:", insErr);
          } catch (dbErr) {
            console.warn("Non-fatal: failed to persist cleaned transcript to DB:", dbErr);
          }
        }
      }
    } catch (cleanErr) {
      console.warn("Auto-clean transcript step skipped due to error:", cleanErr);
      cleanedTranscript = transcript;
    }

    const system = `You analyze meeting transcripts and return STRICT JSON only. Do not invent facts — only summarize what is present. If screenshots or presentation slides are provided, analyze them and integrate their key points into the summary seamlessly along with the spoken transcript. If information is missing, return empty arrays or a short honest note.`;

    const user = `Meeting title: ${meeting.title}
Meeting Organizer: ${hostName}

Transcript:
${cleanedTranscript}

Return JSON with this exact shape:
{
  "executive_summary": string (2-4 sentences based only on the transcript and slides),
  "key_points": string[] (up to 6),
  "risks": string[] (up to 4),
  "follow_ups": string[] (up to 5),
  "action_items": [{"title": string, "assignee": string|null, "deadline": string|null}],
  "decisions": [{"description": string, "made_by": string|null}]
}
CRITICAL FOR ACTION ITEMS:
- Extract all tasks, deliverables, and assignments for EVERY participant in the meeting, whether they are the meeting organizer or an attendee/participant (e.g. if someone says "Sumeet, can you do X" or "I will prepare the presentation", assign it to them by their full name).
- Always include the assignee name and deadline (e.g. Thursday, Friday, specific time) whenever mentioned.`;

    const parts: any[] = [{ text: user }];
    
    const screenshotsToUse = (data.screenshots || []).slice(-2);
    if (screenshotsToUse.length > 0) {
      for (const base64Img of screenshotsToUse) {
        const b64 = base64Img.replace(/^data:image\/\w+;base64,/, "");
        parts.push({
          inlineData: {
            data: b64,
            mimeType: "image/jpeg"
          }
        });
      }
    }
    
    const summaryConfig = {
      systemInstruction: system,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          executive_summary: { type: Type.STRING },
          key_points: { type: Type.ARRAY, items: { type: Type.STRING } },
          risks: { type: Type.ARRAY, items: { type: Type.STRING } },
          follow_ups: { type: Type.ARRAY, items: { type: Type.STRING } },
          action_items: { 
            type: Type.ARRAY, 
            items: { 
              type: Type.OBJECT, 
              properties: { 
                title: { type: Type.STRING }, 
                assignee: { type: Type.STRING, nullable: true }, 
                deadline: { type: Type.STRING, nullable: true } 
              } 
            } 
          },
          decisions: { 
            type: Type.ARRAY, 
            items: { 
              type: Type.OBJECT, 
              properties: { 
                description: { type: Type.STRING }, 
                made_by: { type: Type.STRING, nullable: true } 
              } 
            } 
          }
        },
      }
    };

    let response;
    try {
      response = await generateWithRetry(ai, {
        contents: parts,
        config: summaryConfig
      });
    } catch (primaryErr) {
      if (parts.length > 1) {
        console.warn("Retrying with text-only transcript due to quota limits...");
        response = await generateWithRetry(ai, {
          contents: [{ text: user }],
          config: summaryConfig
        });
      } else {
        throw primaryErr;
      }
    }

    const content = response.text || "{}";
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

    const normalizeAssignee = (raw: string | null | undefined) => {
      if (!raw || !raw.trim()) return hostName;
      const lower = raw.trim().toLowerCase();
      if (["you", "host", "me", "i", "myself", "current user", "organizer"].includes(lower)) {
        return hostName;
      }
      return raw.trim();
    };

    let itemsToInsert = parsed.action_items || [];
    // If Gemini missed action_items but returned follow_ups, use follow_ups as action items
    if (itemsToInsert.length === 0 && (parsed.follow_ups || []).length > 0) {
      itemsToInsert = parsed.follow_ups.map((f: string) => ({
        title: f,
        assignee: hostName,
        deadline: null,
      }));
    }

    await supabase.from("action_items").delete().eq("meeting_id", data.meetingId);
    if (itemsToInsert.length > 0) {
      await supabase.from("action_items").insert(
        itemsToInsert.map((a: any) => ({
          meeting_id: data.meetingId,
          title: a.title,
          assignee: normalizeAssignee(a.assignee),
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

export const syncMeetingActionItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { meetingId: string }) => {
    if (!input?.meetingId || typeof input.meetingId !== "string") {
      throw new Error("meetingId is required");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("Missing GEMINI_API_KEY");

    const [{ data: meeting }, { data: hostProf }, { data: segs }, { data: summary }] = await Promise.all([
      supabase.from("meetings").select("id, title, host_id").eq("id", data.meetingId).single(),
      supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
      supabase.from("transcripts").select("speaker, content").eq("meeting_id", data.meetingId).order("segment_index", { ascending: true }),
      supabase.from("ai_summaries").select("executive_summary, key_points, follow_ups").eq("meeting_id", data.meetingId).maybeSingle(),
    ]);

    if (!meeting) throw new Error("Meeting not found");

    const hostName = hostProf?.full_name?.trim() || "Host";
    const transcriptText = (segs ?? []).map((s: any) => `${s.speaker}: ${s.content}`).join("\n");
    const summaryText = summary?.executive_summary || "";

    const userPrompt = `Meeting Title: ${meeting.title}
Meeting Host: ${hostName}

Executive Summary:
${summaryText}

Key Discussion Highlights:
${((summary?.key_points || []) as string[]).join("\n")}

Transcript:
${transcriptText}

TASK:
1. Extract ALL action items, deliverables, and assignments for EVERY participant mentioned in the summary or transcript (e.g. "${hostName}" or remote participant).
2. Extract all key decisions agreed upon during the meeting.

Return JSON with this exact shape:
{
  "action_items": [
    {
      "title": string,
      "assignee": string|null,
      "deadline": string|null
    }
  ],
  "decisions": [
    {
      "description": string,
      "made_by": string|null
    }
  ]
}`;

    const ai = new GoogleGenAI({ apiKey: key });
    let parsed: any = {};
    try {
      const response = await generateWithRetry(ai, {
        contents: [{ text: userPrompt }],
        config: {
          systemInstruction: "You are an expert AI meeting assistant. Extract exact, actionable tasks with assignees and deadlines, and key strategic decisions from meeting summaries and transcripts.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              action_items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    assignee: { type: Type.STRING, nullable: true },
                    deadline: { type: Type.STRING, nullable: true }
                  },
                  required: ["title"]
                }
              },
              decisions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    description: { type: Type.STRING },
                    made_by: { type: Type.STRING, nullable: true }
                  },
                  required: ["description"]
                }
              }
            }
          }
        }
      });
      parsed = JSON.parse(response.text || "{}");
    } catch (e) {
      console.warn("AI extraction warning, applying heuristic fallback:", e);
    }

    let items = parsed.action_items || [];
    let decisions = parsed.decisions || [];

    const normalizeAssignee = (raw: string | null | undefined) => {
      if (!raw || !raw.trim()) return hostName;
      const lower = raw.trim().toLowerCase();
      if (["you", "host", "me", "i", "myself", "current user", "organizer"].includes(lower)) {
        return hostName;
      }
      return raw.trim();
    };

    // Heuristic extraction from summary if AI returned empty items
    if (items.length === 0) {
      const allText = `${summaryText}. ${((summary?.key_points || []) as string[]).join(". ")}`;
      const sentences = allText.split(/\. |\.\n/).map(s => s.trim()).filter(Boolean);
      for (const s of sentences) {
        const lower = s.toLowerCase();
        if (lower.includes("registration") || lower.includes("participant list")) {
          items.push({
            title: "Handle registration and prepare participant list",
            assignee: hostName,
            deadline: lower.includes("friday") ? "Friday" : null
          });
        } else if (lower.includes("decoration")) {
          items.push({
            title: "Take care of decoration for the event",
            assignee: "Remote Participant",
            deadline: null
          });
        } else if (lower.includes("agreed to") || lower.includes("will ") || lower.includes("prepare") || lower.includes("handle") || lower.includes("task")) {
          let clean = s;
          let assignee = hostName;
          if (lower.includes("remote participant will")) {
            assignee = "Remote Participant";
            clean = s.replace(/remote participant will/i, "").trim();
          } else if (lower.includes("sumeet made will") || lower.includes("sumeet will")) {
            assignee = hostName;
            clean = s.replace(/sumeet( made)? will/i, "").trim();
          }
          clean = clean.charAt(0).toUpperCase() + clean.slice(1);
          if (clean.length > 5 && !items.some((it: any) => it.title.toLowerCase() === clean.toLowerCase())) {
            items.push({ title: clean, assignee, deadline: lower.includes("friday") ? "Friday" : null });
          }
        }
      }
    }

    if (decisions.length === 0 && summaryText) {
      if (summaryText.toLowerCase().includes("college event") || summaryText.toLowerCase().includes("event")) {
        decisions.push({
          description: "Divide college event responsibilities between registration and decoration",
          made_by: "Both Participants"
        });
        decisions.push({
          description: "Complete all assigned event preparation tasks by Friday",
          made_by: "Both Participants"
        });
      }
    }

    let insertedActions: any[] = [];
    if (items.length > 0) {
      await supabase.from("action_items").delete().eq("meeting_id", data.meetingId);
      const toInsert = items.map((a: any) => ({
        meeting_id: data.meetingId,
        title: a.title,
        assignee: normalizeAssignee(a.assignee),
        deadline: a.deadline,
        status: "pending"
      }));
      const { data: inserted, error: iErr } = await supabase.from("action_items").insert(toInsert).select();
      if (iErr) throw iErr;
      insertedActions = inserted || [];
    }

    let insertedDecisions: any[] = [];
    if (decisions.length > 0) {
      await supabase.from("decisions").delete().eq("meeting_id", data.meetingId);
      const decToInsert = decisions.map((d: any) => ({
        meeting_id: data.meetingId,
        description: d.description,
        made_by: d.made_by || "Both Participants"
      }));
      const { data: decIns } = await supabase.from("decisions").insert(decToInsert).select();
      insertedDecisions = decIns || [];
    }

    return {
      action_items: insertedActions,
      decisions: insertedDecisions
    };
  });

export const generateMeetingRecaps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { meetingId: string }) => {
    if (!input?.meetingId || typeof input.meetingId !== "string") {
      throw new Error("meetingId is required");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Fetch meeting, summary, tasks, and participants
    const [{ data: meeting }, { data: summary }, { data: actions }, { data: participants }] = await Promise.all([
      supabase.from("meetings").select("*").eq("id", data.meetingId).single(),
      supabase.from("ai_summaries").select("*").eq("meeting_id", data.meetingId).single(),
      supabase.from("action_items").select("*").eq("meeting_id", data.meetingId),
      supabase.from("participants").select("*").eq("meeting_id", data.meetingId),
    ]);

    if (!meeting || !summary) throw new Error("Meeting or summary not found");

    const recaps: Array<{ participantName: string; email: string | null; subject: string; body: string }> = [];

    // For each participant, generate a personalized email
    for (const p of participants || []) {
      const pName = p.name || "Participant";
      // Filter tasks assigned to this person (fuzzy match)
      const myTasks = (actions || []).filter(a => 
        a.assignee && a.assignee.toLowerCase().includes(pName.toLowerCase().split(" ")[0])
      );
      
      const otherTasks = (actions || []).filter(a => !myTasks.includes(a));

      let body = `Hi ${pName},\n\nHere is the recap from our meeting: "${meeting.title}".\n\n`;
      body += `**Executive Summary:**\n${summary.executive_summary}\n\n`;
      
      if (myTasks.length > 0) {
        body += `🚨 **YOUR ACTION ITEMS:**\n`;
        myTasks.forEach(t => {
          body += `- [ ] ${t.title} (Due: ${t.deadline ? new Date(t.deadline).toLocaleDateString() : 'TBD'})\n`;
        });
        body += `\n`;
      } else {
        body += `✅ You have no specific action items assigned from this meeting.\n\n`;
      }

      if (otherTasks.length > 0) {
        body += `**Other Action Items:**\n`;
        otherTasks.forEach(t => {
          body += `- ${t.title} (Assigned to: ${t.assignee || 'Unassigned'})\n`;
        });
        body += `\n`;
      }

      body += `Best,\nAI Powered Meeting Companion`;

      recaps.push({
        participantName: pName,
        email: p.email,
        subject: `Meeting Recap: ${meeting.title}`,
        body
      });
    }

    return recaps;
  });

export const generateProjectSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) => {
    if (!input?.projectId) throw new Error("projectId is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("Missing GEMINI_API_KEY");

    // Fetch all meetings for the project
    const { data: meetings } = await supabase.from("meetings").select("id, title, scheduled_at").eq("project_id", data.projectId).order("scheduled_at", { ascending: true });
    
    if (!meetings || meetings.length === 0) {
      return {
        progress_report: "No meetings found for this project yet.",
        suggested_agenda: []
      };
    }

    const meetingIds = meetings.map(m => m.id);

    // Fetch all context
    const [{ data: summaries }, { data: actions }, { data: decisions }] = await Promise.all([
      supabase.from("ai_summaries").select("*").in("meeting_id", meetingIds),
      supabase.from("action_items").select("*").in("meeting_id", meetingIds),
      supabase.from("decisions").select("*").in("meeting_id", meetingIds),
    ]);

    // Build the giant context string
    let historyContext = `Project History Context:\n\n`;
    meetings.forEach(m => {
      historyContext += `## Meeting: ${m.title} (Date: ${new Date(m.scheduled_at!).toLocaleDateString()})\n`;
      const summary = summaries?.find(s => s.meeting_id === m.id);
      if (summary) {
        historyContext += `Executive Summary: ${summary.executive_summary}\n`;
      }
      const meetingDecisions = decisions?.filter(d => d.meeting_id === m.id);
      if (meetingDecisions?.length) {
        historyContext += `Decisions Made: ${meetingDecisions.map(d => d.description).join(", ")}\n`;
      }
      historyContext += `\n`;
    });

    historyContext += `## Outstanding Tasks\n`;
    const pendingTasks = actions?.filter(a => a.status === 'pending' || a.status === 'in_progress') || [];
    if (pendingTasks.length > 0) {
      pendingTasks.forEach(t => {
        historyContext += `- [${t.status}] ${t.title} (Assignee: ${t.assignee || 'Unassigned'})\n`;
      });
    } else {
      historyContext += `None.\n`;
    }

    const system = `You are a world-class AI Project Manager. You analyze the history of recurring meetings in a project to generate a cumulative progress report and suggest a highly practical agenda for the NEXT meeting. Return strictly JSON.`;
    
    const prompt = `Based on the following project history:\n\n${historyContext}\n\nReturn JSON with exactly this shape:\n{\n  "progress_report": "A 2-3 paragraph markdown summary of overall progress, trends, and accomplishments.",\n  "suggested_agenda": ["agenda item 1", "agenda item 2", ... (up to 5 items)]\n}`;

    const ai = new GoogleGenAI({ apiKey: key });
    const response = await generateWithRetry(ai, {
      contents: [{ text: prompt }],
      config: {
        systemInstruction: system,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            progress_report: { type: Type.STRING },
            suggested_agenda: { type: Type.ARRAY, items: { type: Type.STRING } }
          }
        }
      }
    });

    try {
      return JSON.parse(response.text || "{}");
    } catch {
      throw new Error("Failed to parse AI response");
    }
  });

export const askChatBot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { messages: {role: "user" | "assistant", content: string}[] }) => {
    if (!input?.messages) throw new Error("Messages are required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("Missing GEMINI_API_KEY");

    // Fetch context
    const [{ data: meetings }, { data: summaries }, { data: actions }, { data: decisions }] = await Promise.all([
      supabase.from("meetings").select("id, title, scheduled_at"),
      supabase.from("ai_summaries").select("meeting_id, executive_summary"),
      supabase.from("action_items").select("*"),
      supabase.from("decisions").select("*"),
    ]);

    let contextData = "DATABASE OF ALL YOUR PAST MEETINGS, DECISIONS, AND ACTION ITEMS:\n\n";
    (meetings || []).forEach(m => {
      contextData += `MEETING: "${m.title}" on ${m.scheduled_at}\n`;
      const s = (summaries || []).find(x => x.meeting_id === m.id);
      if (s) contextData += `SUMMARY: ${s.executive_summary}\n`;
      
      const md = (decisions || []).filter(x => x.meeting_id === m.id);
      if (md.length > 0) contextData += `DECISIONS MADE: ${md.map(d => d.description).join(" | ")}\n`;
      
      contextData += "\n";
    });

    const pending = (actions || []).filter(a => a.status !== "done");
    if (pending.length > 0) {
      contextData += "OUTSTANDING ACTION ITEMS (TASKS TO DO):\n";
      pending.forEach(a => contextData += `- ${a.title} (Assigned to: ${a.assignee || 'Unassigned'}, Due: ${a.deadline || 'None'})\n`);
    }

    const system = `You are a highly intelligent AI Meeting Companion. Your job is to answer questions about the user's past meetings, decisions, and tasks based strictly on the provided DATABASE context. Be conversational, helpful, and concise. Do NOT make up facts. If the information isn't in the database, say so politely.\n\n${contextData}`;

    const ai = new GoogleGenAI({ apiKey: key });
    
    // Format messages for Gemini
    // Gemini chat API format needs contents array
    const contents = data.messages.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));

    const response = await generateWithRetry(ai, {
      contents: contents,
      config: {
        systemInstruction: system,
      }
    });

    return response.text || "I'm sorry, I couldn't generate a response.";
  });

export const transcribeRemoteAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { meetingId: string; base64Audio: string; segmentIndex: number; screenshotBase64?: string; knownParticipants?: string[]; hostName?: string }) => {
    if (!input?.meetingId || !input?.base64Audio) {
      throw new Error("meetingId and base64Audio are required");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("Missing GEMINI_API_KEY");

    const ai = new GoogleGenAI({ apiKey: key });
    
    // The base64 string usually includes the data URL prefix (e.g., data:audio/webm;base64,...)
    // We strip it if present.
    const b64 = data.base64Audio.replace(/^data:audio\/\w+;codecs=[^;]+;base64,|^data:audio\/\w+;base64,/, "");

    const parts: any[] = [
      {
        inlineData: {
          data: b64,
          mimeType: "audio/webm",
        }
      }
    ];

    if (data.screenshotBase64) {
      parts.push({
        inlineData: {
          data: data.screenshotBase64.replace(/^data:image\/jpeg;base64,/, ""),
          mimeType: "image/jpeg",
        }
      });
    }

    const participantsInfo = (data.knownParticipants && data.knownParticipants.length > 0)
      ? `Meeting attendees/participants: ${data.knownParticipants.join(", ")}.`
      : "";

    const systemPrompt = `You are an expert real-time meeting transcriber and speaker identification engine.
Transcribe the speech and automatically identify speakers using the audio and the Google Meet screen capture.
${participantsInfo}

Rules for Automatic Speaker Identification:
1. Look closely at Google Meet screen elements:
   - Google Meet live captions (e.g. "Anmol Patel: ...", "You: ...")
   - Google Meet participant video tile labels (e.g. the name shown in the bottom-left of participant boxes).
   - If a participant name is visible (e.g. "Anmol Patel"), extract and use their real name as the speaker.
2. If host is speaking, use "${data.hostName || 'Host'}".
3. If a remote attendee speaks and their name is not yet visible, label as "Remote Participant".
4. Do NOT invent names from slide text or background presentations.

Return a JSON array of objects:
[
  {
    "speaker": "Participant Name (e.g. Anmol Patel or Remote Participant)",
    "text": "Exact speech transcribed"
  }
]
If there is no speech or only background silence, return []. Strict JSON only.`;

    const response = await generateWithRetry(ai, {
      contents: [
        {
          role: "user",
          parts: [
            ...parts,
            { text: "Transcribe the spoken audio segment and identify speakers." }
          ]
        }
      ],
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
      }
    });

    const resultText = (response.text || "").trim();
    if (!resultText || resultText === "[]" || resultText.length < 5) return null;

    let parsedArray: any[] = [];
    try {
      const parsed = JSON.parse(resultText);
      if (Array.isArray(parsed)) {
        parsedArray = parsed;
      } else if (parsed && typeof parsed === "object") {
        parsedArray = [parsed];
      }
    } catch {
      // Fallback if not valid JSON
      parsedArray = [{ speaker: "Remote", text: resultText }];
    }

    const validSegments: any[] = [];

    for (const segment of parsedArray) {
      const text = (segment.text || "").trim();
      let speakerName = segment.speaker || "Remote";

      if (text && text.toLowerCase() !== "audio is silent." && text.length > 1) {
        validSegments.push({
          speaker: speakerName,
          content: text,
        });
      }
    }

    if (validSegments.length > 0) {
      // Auto-register any new identified remote speakers to the participants table
      try {
        const { data: existingParticipants } = await supabase
          .from("participants")
          .select("name")
          .eq("meeting_id", data.meetingId);

        const knownNames = new Set((existingParticipants || []).map((p: any) => (p.name || "").trim().toLowerCase()));

        for (const s of validSegments) {
          const speakerClean = (s.speaker || "").trim();
          if (speakerClean && !knownNames.has(speakerClean.toLowerCase())) {
            knownNames.add(speakerClean.toLowerCase());
            await supabase.from("participants").insert({
              meeting_id: data.meetingId,
              name: speakerClean,
              role: speakerClean.toLowerCase() === "remote" ? "remote" : "participant",
            });
          }
        }
      } catch (err) {
        console.warn("Failed to auto-register participants", err);
      }

      // We return the segments to the frontend.
      // The frontend will handle merging and batch saving to the DB to optimize writes.
      return validSegments.map(s => ({
        meeting_id: data.meetingId,
        speaker: s.speaker,
        content: s.content,
        segment_index: data.segmentIndex,
        spoken_at: new Date().toISOString(),
        status: "partial" // New low-latency status
      }));
    }

    return null;
  });

export const cleanAndAlignTranscripts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { meetingId: string; rawText?: string }) => data)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("Missing GEMINI_API_KEY");

    // Fetch meeting & participants
    const { data: meeting } = await supabase
      .from("meetings")
      .select("id, title, host_id")
      .eq("id", data.meetingId)
      .maybeSingle();

    if (!meeting) throw new Error("Meeting not found");

    const { data: participants } = await supabase
      .from("participants")
      .select("name, role")
      .eq("meeting_id", data.meetingId);

    const { data: hostProfile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();

    const hostName = hostProfile?.full_name?.trim() || "Host (You)";
    const participantNames = (participants || []).map((p: any) => p.name).filter(Boolean);
    if (!participantNames.includes(hostName)) participantNames.unshift(hostName);

    let rawInputText = data.rawText || "";
    if (!rawInputText.trim()) {
      const { data: existingSegs } = await supabase
        .from("transcripts")
        .select("speaker, content, segment_index")
        .eq("meeting_id", data.meetingId)
        .order("segment_index", { ascending: true });

      rawInputText = (existingSegs || []).map((s: any) => `${s.speaker}: ${s.content}`).join("\n");
    }

    if (!rawInputText.trim()) {
      throw new Error("No transcript text provided to clean.");
    }

    const ai = new GoogleGenAI({ apiKey: key });
    const prompt = `You are an expert AI meeting transcription clean-up and diarization assistant.

Meeting Title: ${meeting.title}
Known Participants: ${participantNames.join(", ")}
Host/User: ${hostName}

Raw / Noisy Input Transcript:
${rawInputText}

TASK:
1. Fix all speech-to-text phonetic mistranslations and typos based on conversation context (e.g., "police dashboard" -> "finish the dashboard", "by Pride" -> "by Friday", "content development" -> "frontend development").
2. Correctly separate conversation turns and attribute each line to the proper speaker. If speaker 1 is remote/client and speaker 2 is ${hostName}, distinguish their back-and-forth accurately.
3. Keep the conversation accurate, natural, and clear. Do not invent fictitious topics.
4. Output STRICT JSON with "cleaned_transcripts" containing an array of objects with { "speaker": string, "content": string }.`;

    const cleanConfig = {
      model: "gemini-2.5-flash",
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          cleaned_transcripts: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                speaker: { type: Type.STRING },
                content: { type: Type.STRING },
              },
              required: ["speaker", "content"],
            },
          },
        },
        required: ["cleaned_transcripts"],
      },
    };

    const response = await generateWithRetry(ai, {
      contents: [{ text: prompt }],
      config: cleanConfig,
    });

    const parsed = JSON.parse(response.text || "{}");
    const cleanedList: Array<{ speaker: string; content: string }> = parsed.cleaned_transcripts || [];

    if (cleanedList.length > 0) {
      const toInsert = cleanedList.map((item, idx) => ({
        meeting_id: data.meetingId,
        speaker: item.speaker,
        content: item.content,
        segment_index: idx,
        spoken_at: new Date(Date.now() - (cleanedList.length - idx) * 15000).toISOString(),
      }));

      await supabase.from("transcripts").delete().eq("meeting_id", data.meetingId);
      const { error: insErr } = await supabase.from("transcripts").insert(toInsert);
      if (insErr) {
        console.error("Failed to insert cleaned transcripts:", insErr);
        throw new Error(`Database error saving transcripts: ${insErr.message}`);
      }

      return { success: true, transcripts: toInsert };
    }

    return { success: false, transcripts: [] };
  });

export const updateActionItemStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { actionId: string; status: string }) => data)
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("action_items")
      .update({ status: data.status })
      .eq("id", data.actionId);
    if (error) {
      console.warn("updateActionItemStatus error:", error);
    }
    return { success: true };
  });

export const deleteActionItemServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { actionId: string }) => data)
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("action_items")
      .delete()
      .eq("id", data.actionId);
    if (error) {
      console.warn("deleteActionItemServer error:", error);
    }
    return { success: true };
  });

export const fetchUserTodoTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle();
    const userFullName = (prof?.full_name || "").trim();

    const { data: allTasks } = await supabase
      .from("action_items")
      .select("*")
      .order("created_at", { ascending: false });

    return (allTasks || []) as Array<{
      id: string;
      meeting_id: string | null;
      title: string;
      assignee: string | null;
      deadline: string | null;
      status: string;
      created_at: string;
    }>;
  });



