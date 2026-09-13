import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { GoogleGenAI, Type } from "@google/genai";

async function generateWithRetry(ai: any, params: any, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err: any) {
      const msg = err?.message || "";
      if ((msg.includes("503") || msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("UNAVAILABLE")) && i < maxRetries - 1) {
        console.warn(`API ${msg.includes("429") ? "429" : "503"} error, retrying in ${(i+1)*2}s...`);
        await new Promise(r => setTimeout(r, (i + 1) * 2000));
      } else {
        throw err;
      }
    }
  }
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

    const system = `You analyze meeting transcripts and return STRICT JSON only. Do not invent facts — only summarize what is present. If screenshots or presentation slides are provided, analyze them and integrate their key points into the summary seamlessly along with the spoken transcript. If information is missing, return empty arrays or a short honest note.`;

    const user = `Meeting title: ${meeting.title}

Transcript:
${transcript}

Return JSON with this exact shape:
{
  "executive_summary": string (2-4 sentences based only on the transcript and slides),
  "key_points": string[] (up to 6),
  "risks": string[] (up to 4),
  "follow_ups": string[] (up to 5),
  "action_items": [{"title": string, "assignee": string|null, "deadline": string|null}],
  "decisions": [{"description": string, "made_by": string|null}]
}`;

    const ai = new GoogleGenAI({ apiKey: key });
    
    const parts: any[] = [{ text: user }];
    
    if (data.screenshots && data.screenshots.length > 0) {
      for (const base64Img of data.screenshots) {
        const b64 = base64Img.replace(/^data:image\/\w+;base64,/, "");
        parts.push({
          inlineData: {
            data: b64,
            mimeType: "image/jpeg"
          }
        });
      }
    }
    
    const response = await generateWithRetry(ai, {
      model: "gemini-3.6-flash",
      contents: parts,
      config: {
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
      }
    });

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
      model: "gemini-3.6-flash",
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
      model: "gemini-3.6-flash",
      contents: contents,
      config: {
        systemInstruction: system,
      }
    });

    return response.text || "I'm sorry, I couldn't generate a response.";
  });

export const transcribeRemoteAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { meetingId: string; base64Audio: string; segmentIndex: number; screenshotBase64?: string }) => {
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

    const systemPrompt = `You are a highly accurate, low-latency speech-to-text transcriber for a video meeting. Listen to the audio chunk and return the exact words spoken.
If an image is provided, it is a screenshot of the video meeting taken during this exact audio segment. 
Use the image to identify WHO is speaking. Look for the highlighted video tile, the "talking" indicator, or the active speaker's name tag.
Return your response as a JSON array of objects, where each object represents a continuous spoken segment.
Each object must have two keys: "speaker" (the EXACT name you identified from the screen, or "Remote" if you can't tell) and "text" (the transcribed text).
If multiple people speak, create a new object for each speaker change.
If there is no discernible speech or only silence, return an empty array []. Do not add markdown, quotes, or any formatting.`;

    const response = await generateWithRetry(ai, {
      model: "gemini-3.6-flash", 
      contents: [
        {
          role: "user",
          parts: [
            ...parts,
            { text: "Transcribe this audio segment." }
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
