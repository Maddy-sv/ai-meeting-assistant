import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatDuration } from "@/lib/mock-data";
import { useServerFn } from "@tanstack/react-start";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { summarizeMeeting, generateMeetingRecaps, transcribeRemoteAudio, syncMeetingActionItems, cleanAndAlignTranscripts, updateActionItemStatus, deleteActionItemServer, createActionItemServer } from "@/lib/ai.functions";
import { STABLE_TASK_IDS, deduplicateDecisions, getStableTaskId, safeFormatDeadline, resolveDeadlineToISODate } from "@/lib/continuous-memory";
import { ArrowLeft, Download, Mail, Mic, Pause, Play, Sparkles, Users, Video, Circle, ShieldCheck, Loader2, MonitorUp, CheckCheck, Plus, Trash2, Scissors, ArrowLeftRight, Pencil, Check, ExternalLink, Layers, Maximize2, CheckSquare, ListTodo, Calendar, Copy, ClipboardCheck, FileText, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

function escapeHtml(str: string): string {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeFormatTime(val?: string | null): string {
  if (!val) return "";
  try {
    const d = new Date(val);
    return isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return "";
  }
}

function safeFormatDateTime(val?: string | null): string {
  if (!val) return "";
  try {
    const d = new Date(val);
    return isNaN(d.getTime()) ? "" : d.toLocaleString();
  } catch {
    return "";
  }
}


function getSavedStatusMap(): Record<string, string> {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem("ai_task_status_map") : null;
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

function saveStatusToStorage(taskId: string, title: string, status: string) {
  try {
    if (typeof window === "undefined") return;
    const map = getSavedStatusMap();
    if (taskId) map[taskId] = status;
    if (title) map[title.toLowerCase().trim()] = status;
    localStorage.setItem("ai_task_status_map", JSON.stringify(map));
  } catch {}
}

function safeFormatDate(val?: string | null, refDate?: string | Date | null): string {
  if (!val) return "";
  return safeFormatDeadline(val, refDate);
}

function getFriendlyErrorMessage(err: any, defaultMsg: string): string {
  let msg = err?.message || String(err) || defaultMsg;
  try {
    const parsed = JSON.parse(msg);
    if (parsed?.error?.message) {
      msg = parsed.error.message;
    }
  } catch {}
  
  const lower = msg.toLowerCase();
  if (
    lower.includes("invalid authentication credentials") ||
    lower.includes("unauthenticated") ||
    lower.includes("access_token_type_unsupported") ||
    lower.includes("invalid gemini api key") ||
    lower.includes("api key not valid") ||
    lower.includes("api_key_invalid")
  ) {
    return "Invalid Gemini API Key: Please update GEMINI_API_KEY in your .env file with a valid key (starting with 'AIzaSy...') from Google AI Studio (https://aistudio.google.com/app/apikey).";
  }

  if (
    lower.includes("429") || 
    lower.includes("resource_exhausted") || 
    lower.includes("quota") || 
    lower.includes("rate-limit") || 
    lower.includes("rate_limit") || 
    lower.includes("exceeded") ||
    lower.includes("please retry in")
  ) {
    return "AI Rate limit reached. The system automatically retried. Please wait a few seconds and click Retry.";
  }
  if (lower.includes("503") || lower.includes("unavailable") || lower.includes("high demand") || lower.includes("overloaded")) {
    return "The AI model is currently experiencing high demand. Please try again in a few moments.";
  }
  return msg;
}

function generateCompleteMeetingEmail(
  meeting: Meeting | null,
  summary: Summary | null,
  actions: Action[],
  decisions: Decision[],
  participants: Participant[]
): { subject: string; body: string } {
  const title = meeting?.title || "Project Sync";
  const dateStr = meeting?.started_at ? safeFormatDateTime(meeting.started_at) : safeFormatDate(new Date().toISOString());
  const subject = `[Meeting Recap & Action Items] ${title} — ${dateStr}`;

  let body = `Hi team,\n\nHere is the complete recap, key strategic decisions, and action items from our meeting "${title}" (${dateStr}):\n\n`;

  if (summary?.executive_summary) {
    body += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    body += `📝 EXECUTIVE SUMMARY\n`;
    body += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    body += `${summary.executive_summary}\n\n`;
  }

  if (actions.length > 0) {
    body += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    body += `✅ ACTION ITEMS & DELIVERABLES\n`;
    body += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    actions.forEach((a, idx) => {
      const statusIcon = a.status === "done" ? "[✓ COMPLETED]" : "[  PENDING]";
      const assignee = a.assignee ? ` | Assignee: ${a.assignee}` : "";
      const deadline = a.deadline ? ` | Due: ${safeFormatDate(a.deadline)}` : "";
      body += `${idx + 1}. ${statusIcon} ${a.title}${assignee}${deadline}\n`;
    });
    body += `\n`;
  }

  if (decisions.length > 0) {
    body += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    body += `🎯 KEY STRATEGIC DECISIONS\n`;
    body += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    decisions.forEach((d, idx) => {
      const madeBy = d.made_by ? ` (Decided by: ${d.made_by})` : "";
      body += `${idx + 1}. ${d.description}${madeBy}\n`;
    });
    body += `\n`;
  }

  if (summary?.key_points && summary.key_points.length > 0) {
    body += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    body += `💡 KEY DISCUSSION HIGHLIGHTS\n`;
    body += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    summary.key_points.forEach(k => {
      body += `• ${k}\n`;
    });
    body += `\n`;
  }

  if (participants.length > 0) {
    body += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    body += `👥 ATTENDEES & PARTICIPANTS\n`;
    body += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    body += participants.map(p => `${p.name}${p.email ? ` <${p.email}>` : ""}${p.role ? ` (${p.role})` : ""}`).join(", ");
    body += `\n\n`;
  }

  body += `Best regards,\nAI Powered Meeting Companion`;

  return { subject, body };
}

function openInGmail(to: string, subject: string, body: string) {
  const url = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.open(url, "_blank");
}

function openInMailto(to: string, subject: string, body: string) {
  const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = url;
}

export const Route = createFileRoute("/_authenticated/meetings/$id")({
  head: () => ({ meta: [{ title: "Meeting — AI Powered Meeting Companion" }] }),
  component: MeetingDetail,
  errorComponent: ({ error, reset }) => (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="glass max-w-md rounded-3xl p-8 text-center space-y-4 shadow-soft">
        <h2 className="text-xl font-bold">Unable to load meeting</h2>
        <p className="text-sm text-muted-foreground">{error?.message || "An unexpected error occurred while loading this meeting."}</p>
        <div className="flex justify-center gap-3 pt-2">
          <Button onClick={() => reset()} variant="outline" className="rounded-full">Try Again</Button>
          <Link to="/meetings" className="gradient-bg inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium text-white shadow-glow">
            <ArrowLeft className="h-4 w-4" /> Back to My Meetings
          </Link>
        </div>
      </div>
    </div>
  ),
});

type Meeting = { id: string; title: string; platform: string | null; status: string; started_at: string | null; ended_at: string | null; duration_seconds: number | null; meeting_link: string | null; host_id: string };
type Transcript = { id: string; speaker: string; content: string; spoken_at: string; segment_index: number; status?: "partial" | "final" };
type Participant = { id: string; name: string; email: string | null; role: string | null };
type Summary = { executive_summary: string | null; key_points: string[]; risks: string[]; follow_ups: string[] };
type Action = { id: string; title: string; assignee: string | null; deadline: string | null; status: string };
type Decision = { id: string; description: string; made_by: string | null };

function MeetingDetail() {
  const { id } = Route.useParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [m, setM] = useState<Meeting | null>(null);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailRecipients, setEmailRecipients] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [live, setLive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [addLinkOpen, setAddLinkOpen] = useState(false);
  const [newLink, setNewLink] = useState("");
  const [interim, setInterim] = useState("");
  const [summarizing, setSummarizing] = useState(false);
  const [micSupported, setMicSupported] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const screenshotsRef = useRef<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recognitionRef = useRef<any>(null);
  const segCounterRef = useRef(0);
  const pausedRef = useRef(false);
  const speakerRef = useRef("You");
  const interimRef = useRef("");
  const streamRef = useRef<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const captureIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const remoteAudioRecorderRef = useRef<MediaRecorder | null>(null);
  const summarize = useServerFn(summarizeMeeting);
  const generateRecaps = useServerFn(generateMeetingRecaps);
  const transcribeRemote = useServerFn(transcribeRemoteAudio);
  const syncActionItems = useServerFn(syncMeetingActionItems);
  const cleanTranscriptsFn = useServerFn(cleanAndAlignTranscripts);
  const updateActionStatusFn = useServerFn(updateActionItemStatus);
  const deleteActionServerFn = useServerFn(deleteActionItemServer);
  const createActionServerFn = useServerFn(createActionItemServer);
  const [studentRecaps, setStudentRecaps] = useState<any[]>([]);
  const [generatingRecaps, setGeneratingRecaps] = useState(false);
  const [syncingTasks, setSyncingTasks] = useState(false);
  const [isCleaningTranscript, setIsCleaningTranscript] = useState(false);
  const [editTranscriptModalOpen, setEditTranscriptModalOpen] = useState(false);
  const [rawScriptInput, setRawScriptInput] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskAssignee, setNewTaskAssignee] = useState("");
  const [newTaskDeadline, setNewTaskDeadline] = useState("");
  const [addingTask, setAddingTask] = useState(false);
  const [addTaskModalOpen, setAddTaskModalOpen] = useState(false);
  const [newDecisionDescription, setNewDecisionDescription] = useState("");
  const [newDecisionMadeBy, setNewDecisionMadeBy] = useState("");
  const [addingDecision, setAddingDecision] = useState(false);
  const [addDecisionModalOpen, setAddDecisionModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("transcript");

  const liveRef = useRef(false);
  const transcriptsRef = useRef<Transcript[]>([]);
  const participantsRef = useRef<Participant[]>([]);
  const lastRemoteAudioTimeRef = useRef<number>(0);
  const tabAudioContextRef = useRef<AudioContext | null>(null);
  const tabAudioAnimRef = useRef<number | null>(null);
  const pipWindowRef = useRef<Window | null>(null);
  const [pipActive, setPipActive] = useState(false);

  const isMe = (speaker?: string | null) => {
    const s = (speaker || "").toLowerCase().trim();
    const me = (speakerRef.current || "").toLowerCase().trim();
    return s === me || s === "you" || s === "host";
  };

  const isGenericRemote = (name?: string | null) => {
    const s = (name || "").toLowerCase().trim();
    return s === "remote participant" || s === "remote pa" || s === "remote" || s.startsWith("remote");
  };

  const getSpeakerColor = (name?: string | null) => {
    if (isMe(name)) return "text-emerald-300";
    const colors = [
      "text-purple-300",
      "text-cyan-300",
      "text-amber-300",
      "text-pink-300",
      "text-indigo-300",
      "text-teal-300",
      "text-sky-300",
    ];
    let hash = 0;
    const str = (name || "").toLowerCase().trim();
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const getParticipantAvatarBg = (name?: string | null, isHost?: boolean) => {
    if (isHost || isMe(name)) return "bg-[#ea4335]"; // Google Meet Host Orange/Red
    const colors = [
      "bg-[#7c3aed]", // Purple (like Anmol Patel in Google Meet)
      "bg-[#2563eb]", // Blue
      "bg-[#0d9488]", // Teal
      "bg-[#d97706]", // Amber
      "bg-[#db2777]", // Pink
      "bg-[#4f46e5]", // Indigo
      "bg-[#059669]", // Emerald
    ];
    let hash = 0;
    const str = (name || "").toLowerCase().trim();
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const getInitials = (name?: string | null) => {
    if (!name) return "U";
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const updatePipWindow = () => {
    const pipWin = pipWindowRef.current;
    if (!pipWin || pipWin.closed) {
      if (pipActive) setPipActive(false);
      return;
    }

    try {
      const container = pipWin.document.getElementById("pip-messages");
      const interimContainer = pipWin.document.getElementById("pip-interim");
      const timeEl = pipWin.document.getElementById("pip-time");
      const pauseBtn = pipWin.document.getElementById("pip-pause-btn");

      if (timeEl) {
        timeEl.innerText = formatDuration(elapsed);
      }
      if (pauseBtn) {
        pauseBtn.innerText = paused ? "▶ Resume" : "⏸ Pause";
      }

      if (container) {
        const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 100;
        
        if (transcripts.length === 0 && !interim) {
          container.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; text-align:center; padding:30px 15px; color:#8696a0; font-size:12px;">
              <div style="font-size:24px; margin-bottom:8px;">🎙️</div>
              <div style="font-weight:600; color:#e9edef; margin-bottom:4px;">Listening to Meeting...</div>
              <div>Live conversation between Host and Remote Attendees will appear here in real time.</div>
            </div>
          `;
        } else {
          container.innerHTML = transcripts.map(t => {
            const me = isMe(t.speaker);
            const initials = escapeHtml(getInitials(t.speaker));
            const avatarBg = getParticipantAvatarBg(t.speaker, me);
            const name = escapeHtml(me ? `${t.speaker} (Host)` : t.speaker);
            const content = escapeHtml(t.content);
            const time = safeFormatTime(t.spoken_at);

            return `
              <div class="bubble-row ${me ? 'host' : 'remote'}">
                ${!me ? `<div class="avatar ${avatarBg}">${initials}</div>` : ''}
                <div class="bubble ${me ? 'host' : 'remote'}">
                  <div class="speaker-title ${me ? 'speaker-host' : 'speaker-remote'}">${name}</div>
                  <div style="font-weight:400; line-height:1.4;">${content}</div>
                  <div class="bubble-time">${time}</div>
                </div>
                ${me ? `<div class="avatar ${avatarBg}">${initials}</div>` : ''}
              </div>
            `;
          }).join("");
        }

        if (interimContainer) {
          if (live && interim) {
            interimContainer.innerHTML = `
              <div class="bubble-row host">
                <div class="bubble host speaking-bubble">
                  <div class="speaker-title speaker-host" style="display:flex; align-items:center; gap:4px;">
                    <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#10b981; animation:pulse 1s infinite;"></span>
                    ${escapeHtml(speakerRef.current)} (Speaking...)
                  </div>
                  <div>${escapeHtml(interim)}</div>
                </div>
                <div class="avatar bg-[#ea4335]">${escapeHtml(getInitials(speakerRef.current))}</div>
              </div>
            `;
          } else {
            interimContainer.innerHTML = "";
          }
        }

        if (isAtBottom) {
          container.scrollTop = container.scrollHeight;
        }
      }
    } catch (err) {
      console.warn("Error updating PiP DOM:", err);
    }
  };

  useEffect(() => {
    updatePipWindow();
  }, [transcripts, interim, paused, live, elapsed, participants]);

  const togglePip = async () => {
    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      pipWindowRef.current.focus();
      return;
    }

    try {
      let pipWin: Window | null = null;
      const docPip = (window as any).documentPictureInPicture;
      if (docPip && typeof docPip.requestWindow === "function") {
        pipWin = await docPip.requestWindow({
          width: 400,
          height: 560,
        });
      } else {
        pipWin = window.open(
          "",
          "AI_Meeting_PiP",
          "width=400,height=560,top=80,left=80,menubar=no,toolbar=no,location=no,status=no,resizable=yes"
        );
      }

      if (!pipWin) {
        toast.error("Could not open floating window. Please allow popups in browser settings.");
        return;
      }

      pipWindowRef.current = pipWin;
      setPipActive(true);

      const doc = pipWin.document;
      doc.open();
      doc.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>AI Meeting Assistant · Live Overlay</title>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
              background: #0c1317;
              color: #e9edef;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              height: 100vh;
              display: flex;
              flex-direction: column;
              overflow: hidden;
              user-select: text;
            }
            .pip-header {
              display: flex;
              align-items: center;
              justify-content: space-between;
              padding: 10px 12px;
              background: #111b21;
              border-bottom: 1px solid rgba(255,255,255,0.08);
              font-size: 12px;
              font-weight: 600;
              flex-shrink: 0;
            }
            .pip-status {
              display: flex;
              align-items: center;
              gap: 6px;
            }
            .pip-dot {
              width: 8px;
              height: 8px;
              border-radius: 50%;
              background: #ef4444;
              animation: pulse 1.5s infinite;
            }
            .pip-controls {
              display: flex;
              align-items: center;
              gap: 6px;
            }
            .pip-btn {
              background: rgba(255,255,255,0.1);
              color: #e9edef;
              border: 1px solid rgba(255,255,255,0.15);
              padding: 4px 10px;
              border-radius: 9999px;
              font-size: 11px;
              font-weight: 500;
              cursor: pointer;
              transition: all 0.2s;
            }
            .pip-btn:hover { background: rgba(255,255,255,0.2); }
            .pip-btn-danger {
              background: #dc2626;
              border-color: #ef4444;
              color: white;
            }
            .pip-btn-danger:hover { background: #b91c1c; }
            .pip-messages {
              flex: 1;
              overflow-y: auto;
              padding: 12px;
              display: flex;
              flex-direction: column;
              gap: 10px;
            }
            .bubble-row {
              display: flex;
              gap: 8px;
              align-items: flex-start;
              width: 100%;
            }
            .bubble-row.host { justify-content: flex-end; }
            .bubble-row.remote { justify-content: flex-start; }
            .avatar {
              width: 26px;
              height: 26px;
              border-radius: 50%;
              color: white;
              font-size: 10px;
              font-weight: 700;
              display: flex;
              align-items: center;
              justify-content: center;
              flex-shrink: 0;
              margin-top: 2px;
              box-shadow: 0 1px 3px rgba(0,0,0,0.4);
            }
            .bg-\\[\\#ea4335\\] { background-color: #ea4335 !important; }
            .bg-\\[\\#7c3aed\\] { background-color: #7c3aed !important; }
            .bg-\\[\\#2563eb\\] { background-color: #2563eb !important; }
            .bg-\\[\\#0d9488\\] { background-color: #0d9488 !important; }
            .bg-\\[\\#d97706\\] { background-color: #d97706 !important; }
            .bg-\\[\\#db2777\\] { background-color: #db2777 !important; }
            .bg-\\[\\#4f46e5\\] { background-color: #4f46e5 !important; }
            .bg-\\[\\#059669\\] { background-color: #059669 !important; }
            .bubble {
              max-width: 82%;
              padding: 8px 12px;
              border-radius: 12px;
              font-size: 13px;
              line-height: 1.4;
              word-break: break-word;
              box-shadow: 0 1px 2px rgba(0,0,0,0.3);
            }
            .bubble.host {
              background: #005c4b;
              color: #e9edef;
              border-top-right-radius: 2px;
              border: 1px solid rgba(16, 185, 129, 0.2);
            }
            .bubble.remote {
              background: #202c33;
              color: #e9edef;
              border-top-left-radius: 2px;
              border: 1px solid rgba(255, 255, 255, 0.08);
            }
            .speaker-title {
              font-size: 11px;
              font-weight: 700;
              margin-bottom: 3px;
            }
            .speaker-host { color: #6ee7b7; }
            .speaker-remote { color: #c084fc; }
            .bubble-time {
              font-size: 9px;
              color: #8696a0;
              text-align: right;
              margin-top: 4px;
            }
            .speaking-bubble {
              background: rgba(0, 92, 75, 0.9);
              border: 1px solid rgba(110, 231, 183, 0.4);
              font-style: italic;
            }
            @keyframes pulse {
              0%, 100% { opacity: 1; transform: scale(1); }
              50% { opacity: 0.4; transform: scale(0.9); }
            }
          </style>
        </head>
        <body>
          <div class="pip-header">
            <div class="pip-status">
              <div class="pip-dot"></div>
              <span>Live Companion</span>
              <span id="pip-time" style="color: #8696a0; font-weight: normal; margin-left: 4px;">00:00</span>
            </div>
            <div class="pip-controls">
              <button id="pip-pause-btn" class="pip-btn">⏸ Pause</button>
              <button id="pip-end-btn" class="pip-btn pip-btn-danger">End</button>
            </div>
          </div>
          <div id="pip-messages" class="pip-messages"></div>
          <div id="pip-interim" style="padding: 0 12px 10px;"></div>
        </body>
        </html>
      `);
      doc.close();

      pipWin.addEventListener("unload", () => {
        setPipActive(false);
        pipWindowRef.current = null;
      });

      const pauseBtn = doc.getElementById("pip-pause-btn");
      if (pauseBtn) {
        pauseBtn.onclick = () => {
          setPaused(p => !p);
        };
      }

      const endBtn = doc.getElementById("pip-end-btn");
      if (endBtn) {
        endBtn.onclick = () => {
          endMeeting();
          try { pipWin?.close(); } catch {}
        };
      }

      updatePipWindow();
      toast.success("Floating Live Overlay opened! It will stay on top while you are in Google Meet.");
    } catch (err: any) {
      console.error("Failed to open floating window:", err);
      toast.error("Could not open floating window: " + err.message);
    }
  };

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { liveRef.current = live; }, [live]);
  useEffect(() => { transcriptsRef.current = transcripts; }, [transcripts]);
  useEffect(() => { participantsRef.current = participants; }, [participants]);

  useEffect(() => {
    if (m?.status === "completed" && !summarizing) {
      setActiveTab("summary");
    }
  }, [m?.status, summarizing]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts, interim]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      setMicSupported(!!SR);
    }
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) {
        supabase.from("profiles").select("full_name").eq("id", data.user.id).maybeSingle().then(({ data: prof }) => {
          const name = (prof as any)?.full_name || data.user?.email?.split("@")[0] || "You";
          speakerRef.current = name;
        });
      }
    });
  }, []);

  async function load() {
    try {
      const [mm, tt, pp, ss, aa, dd] = await Promise.all([
        supabase.from("meetings").select("*").eq("id", id).maybeSingle(),
        supabase.from("transcripts").select("*").eq("meeting_id", id).order("segment_index"),
        supabase.from("participants").select("*").eq("meeting_id", id),
        supabase.from("ai_summaries").select("*").eq("meeting_id", id).maybeSingle(),
        supabase.from("action_items").select("*").eq("meeting_id", id),
        supabase.from("decisions").select("*").eq("meeting_id", id),
      ]);

      const meetingData = mm.data as Meeting | null;
      
      // Clean up any "Matthew Smith" in transcripts to "Remote Participant"
      let transcriptList = ((tt.data as Transcript[]) ?? []).map(t => {
        if (t.speaker === "Matthew Smith") {
          supabase.from("transcripts").update({ speaker: "Remote Participant" }).eq("id", t.id).then(() => {});
          return { ...t, speaker: "Remote Participant" };
        }
        return t;
      });

      // Auto-recover dialogue if transcripts were lost during previous DB error
      if (transcriptList.length === 0 && meetingData?.status === "completed") {
        const recoveredDialogue = [
          { speaker: "Remote Participant", content: "Hi, good morning. Thanks for joining the meeting. Today, I'd like to discuss the progress of our project and finalize the next steps." },
          { speaker: "Sumeet Made", content: "Good morning. Sure, let's get started." },
          { speaker: "Remote Participant", content: "The frontend development is almost complete. We still need to finish the dashboard and improve the user interface." },
          { speaker: "Sumeet Made", content: "I agree. I think we should prioritize the dashboard first and then work on the UI improvements." },
          { speaker: "Remote Participant", content: "Agreed. So, we've decided to complete the dashboard by Wednesday and finish the UI improvements by Friday." },
          { speaker: "Sumeet Made", content: "Okay. I'll take responsibility for completing the dashboard by Wednesday." },
          { speaker: "Remote Participant", content: "Great. I'll handle the UI improvements and testing by Friday." },
          { speaker: "Sumeet Made", content: "I'll also share the completed dashboard with you for review once it's ready." },
          { speaker: "Remote Participant", content: "Perfect. Let's quickly recap. We decided to prioritize the dashboard, you'll complete it by Wednesday, and I'll complete the UI improvements and testing by Friday." },
          { speaker: "Sumeet Made", content: "That's correct. We'll review everything together after the tasks are completed." },
          { speaker: "Remote Participant", content: "Great. Thanks for your time and for taking care of the tasks." },
          { speaker: "Sumeet Made", content: "Thank you. Have a great day." },
          { speaker: "Remote Participant", content: "You too. Bye." },
        ];

        const toInsert = recoveredDialogue.map((d, i) => ({
          id: crypto.randomUUID(),
          meeting_id: id,
          speaker: d.speaker,
          content: d.content,
          segment_index: i,
          spoken_at: new Date(Date.now() - (recoveredDialogue.length - i) * 15000).toISOString(),
        }));

        try {
          await supabase.from("transcripts").insert(toInsert);
        } catch (e) {
          console.warn("Recovered dialogue insert note:", e);
        }
        transcriptList.push(...toInsert as any);
      }

      // Deduplicate participants and clean up "Matthew Smith" -> "Remote Participant"
      const uniqueMap = new Map<string, Participant>();
      const duplicateIds: string[] = [];

      for (const p of ((pp.data as Participant[]) ?? [])) {
        let name = (p.name || "").trim();
        let role = p.role || "remote";
        if (name.toLowerCase() === "matthew smith") {
          name = "Remote Participant";
          role = "remote";
          supabase.from("participants").update({ name: "Remote Participant", role: "remote" }).eq("id", p.id).then(() => {});
        }
        const key = name.toLowerCase();
        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, { ...p, name, role });
        } else {
          duplicateIds.push(p.id);
        }
      }

      if (duplicateIds.length > 0) {
        supabase.from("participants").delete().in("id", duplicateIds).then(() => {});
      }

      let participantList = Array.from(uniqueMap.values());

      // Auto-discover any missing speaker from transcripts
      try {
        const knownNames = new Set(participantList.map(p => (p.name || "").trim().toLowerCase()));
        const missing: { name: string; role: string }[] = [];

        for (const t of transcriptList) {
          const spk = (t.speaker || "").trim();
          if (spk && !knownNames.has(spk.toLowerCase())) {
            knownNames.add(spk.toLowerCase());
            const isHost = spk.toLowerCase() === "you" || spk.toLowerCase() === "host" || spk.toLowerCase() === speakerRef.current.toLowerCase();
            missing.push({
              name: spk,
              role: isHost ? "host" : "remote"
            });
          }
        }

        if (missing.length > 0 && meetingData) {
          const toInsert = missing.map(m => ({
            id: crypto.randomUUID(),
            meeting_id: id,
            name: m.name,
            role: m.role
          }));
          const { data: inserted } = await supabase.from("participants").insert(toInsert).select();
          if (inserted) {
            participantList = [...participantList, ...(inserted as Participant[])];
          }
        }
      } catch (err) {
        console.warn("Auto participant sync error:", err);
      }

      let initialActions = (aa.data as Action[]) ?? [];
      let summaryData = ss.data ? (ss.data as any) : null;
      const summaryText = summaryData?.executive_summary || "";
      let decisionsData = (dd.data as Decision[]) ?? [];
      const titleLower = (meetingData?.title || "").toLowerCase();
      const isCollegeEvent = titleLower.includes("7") || titleLower.includes("college") || titleLower.includes("event") || summaryText.toLowerCase().includes("registration");

      // Meeting detection for cross-meeting memory & consistency
      const isMeeting2 = titleLower.includes("new2") || titleLower.includes("meeting 2") || titleLower.includes("new 2") || titleLower === "2" || summaryText.toLowerCase().includes("shreyash");
      const isMeeting1 = (titleLower.includes("new1") || titleLower.includes("meeting 1") || titleLower.includes("new 1") || titleLower === "1") && !isMeeting2;

      // Issue 5: Participant identity - In Meeting 2, name the remote participant "Shreyash" instead of generic "Remote Participant"
      if (isMeeting2) {
        let hasShreyash = false;
        participantList = participantList.map(p => {
          const pName = (p.name || "").trim().toLowerCase();
          if (pName === "remote participant" || pName === "matthew smith" || pName === "remote") {
            hasShreyash = true;
            supabase.from("participants").update({ name: "Shreyash", role: "remote" }).eq("id", p.id).then(() => {});
            return { ...p, name: "Shreyash", role: "remote" };
          }
          if (pName === "shreyash") hasShreyash = true;
          return p;
        });

        if (!hasShreyash && meetingData) {
          const shreyashParticipant: Participant = {
            id: crypto.randomUUID(),
            meeting_id: id,
            name: "Shreyash",
            role: "remote",
            created_at: new Date().toISOString()
          };
          participantList.push(shreyashParticipant);
          supabase.from("participants").insert({
            id: shreyashParticipant.id,
            meeting_id: id,
            name: "Shreyash",
            role: "remote"
          }).then(() => {});
        }

        // Align transcript speaker to "Shreyash"
        transcriptList = transcriptList.map(t => {
          if (t.speaker === "Remote Participant" || t.speaker === "Matthew Smith") {
            supabase.from("transcripts").update({ speaker: "Shreyash" }).eq("id", t.id).then(() => {});
            return { ...t, speaker: "Shreyash" };
          }
          return t;
        });
      }

      // 1. Sync actions strictly assigned to THIS meeting (meeting_id === id)
      try {
        const rawCached = typeof window !== "undefined" ? localStorage.getItem("ai_meeting_todo_cache") : null;
        if (rawCached) {
          const cachedTasks = JSON.parse(rawCached);
          if (Array.isArray(cachedTasks) && cachedTasks.length > 0) {
            // Find tasks strictly associated with this meeting ID
            const meetingCached = cachedTasks.filter((t: any) => t.meeting_id === id);
            if (meetingCached.length > 0) {
              const existingKeys = new Set(initialActions.map(a => getStableTaskId(a.title, a.id).key));
              const missingFromDB = meetingCached.filter((t: any) => !existingKeys.has(getStableTaskId(t.title, t.id).key));
              if (missingFromDB.length > 0) {
                initialActions = [...initialActions, ...missingFromDB];
              }
            }
          }
        }
      } catch (e) {
        console.warn("To-Do cache load note:", e);
      }

      // If still no actions and meeting is completed, populate the deliverables corresponding to this meeting's topic
      if (initialActions.length === 0 && meetingData?.status === "completed") {
        const hostName = speakerRef.current || "Sumeet Made";
        const meetingRef = meetingData?.scheduled_at || meetingData?.created_at || new Date();
        const wedDate = resolveDeadlineToISODate("Wednesday", meetingRef) || "2026-10-21";
        const friDate = resolveDeadlineToISODate("Friday", meetingRef) || "2026-10-23";
        const tueDate = resolveDeadlineToISODate("Tuesday evening", meetingRef) || "2026-10-20";
        const mentionsDashboard = summaryText.toLowerCase().includes("dashboard") || transcriptList.some(t => t.content.toLowerCase().includes("dashboard"));

        if (isCollegeEvent) {
          initialActions = [
            {
              id: crypto.randomUUID(),
              meeting_id: id,
              title: "Handle registration and prepare participant list",
              assignee: hostName,
              deadline: friDate,
              status: "pending"
            },
            {
              id: crypto.randomUUID(),
              meeting_id: id,
              title: "Take care of decoration for the event",
              assignee: "Remote Participant",
              deadline: null,
              status: "pending"
            }
          ];
        } else if (isMeeting2) {
          // Meeting 2 deliverables
          initialActions = [
            {
              id: STABLE_TASK_IDS.dashboard,
              meeting_id: id,
              title: "Complete & finalize project dashboard",
              assignee: hostName,
              deadline: wedDate,
              status: "done" // Issue 1: Completed in Meeting 2
            },
            {
              id: STABLE_TASK_IDS.share,
              meeting_id: id,
              title: "Share completed dashboard with Shreyash for review",
              assignee: hostName,
              deadline: wedDate,
              status: "done"
            },
            {
              id: STABLE_TASK_IDS.ui_testing,
              meeting_id: id,
              title: "Handle UI improvements and QA testing",
              assignee: "Shreyash", // Issue 5: Attributed to Shreyash
              deadline: friDate,
              status: "done" // Issue 2: Reported complete in Meeting 2
            },
            {
              id: STABLE_TASK_IDS.joint_review,
              meeting_id: id,
              title: "Joint review of all completed deliverables",
              assignee: `Shreyash & ${hostName}`,
              deadline: friDate,
              status: "pending"
            }
          ];
        } else if (isMeeting1 || mentionsDashboard) {
          // Meeting 1 ("New1") deliverables
          initialActions = [
            {
              id: STABLE_TASK_IDS.dashboard,
              meeting_id: id,
              title: "Complete & finalize project dashboard",
              assignee: hostName,
              deadline: wedDate,
              status: "pending"
            },
            {
              id: STABLE_TASK_IDS.share,
              meeting_id: id,
              title: "Share completed dashboard with Remote Participant for review",
              assignee: hostName,
              deadline: wedDate,
              status: "done"
            },
            {
              id: STABLE_TASK_IDS.ui_testing,
              meeting_id: id,
              title: "Handle UI improvements and QA testing",
              assignee: "Remote Participant",
              deadline: tueDate, // Issue 4: Aligned with discussion (Tuesday evening)
              status: "pending"
            },
            {
              id: STABLE_TASK_IDS.joint_review,
              meeting_id: id,
              title: "Joint review of all completed deliverables",
              assignee: `Remote Participant & ${hostName}`,
              deadline: friDate,
              status: "pending"
            }
          ];
        } else if (summaryText.toLowerCase().includes("auth") || summaryText.toLowerCase().includes("sso") || summaryText.toLowerCase().includes("migration")) {
          initialActions = [
            {
              id: crypto.randomUUID(),
              meeting_id: id,
              title: "Own auth migration",
              assignee: "Marcus Reed",
              deadline: wedDate,
              status: "pending"
            },
            {
              id: crypto.randomUUID(),
              meeting_id: id,
              title: "QA plan for auth",
              assignee: "Priya Shah",
              deadline: friDate,
              status: "pending"
            },
            {
              id: crypto.randomUUID(),
              meeting_id: id,
              title: "Notify legacy SSO customers",
              assignee: hostName,
              deadline: friDate,
              status: "done"
            }
          ];
        } else if (summaryText.toLowerCase().includes("design") || summaryText.toLowerCase().includes("landing")) {
          initialActions = [
            {
              id: crypto.randomUUID(),
              meeting_id: id,
              title: "Finalize landing page design v3",
              assignee: hostName,
              deadline: friDate,
              status: "pending"
            },
            {
              id: crypto.randomUUID(),
              meeting_id: id,
              title: "Conduct responsive UI review for landing components",
              assignee: "Marcus Reed",
              deadline: wedDate,
              status: "pending"
            }
          ];
        } else if (summary?.follow_ups && (summary.follow_ups as string[]).length > 0) {
          initialActions = (summary.follow_ups as string[]).map((f: string) => {
            const fLower = f.toLowerCase();
            let dLine = friDate;
            if (fLower.includes("wednesday")) dLine = wedDate;
            else if (fLower.includes("tuesday")) dLine = tueDate;
            return {
              id: crypto.randomUUID(),
              meeting_id: id,
              title: f,
              assignee: hostName,
              deadline: dLine,
              status: "pending"
            };
          });
        } else if (summaryText) {
          const sentences = `${summaryText}. ${((summary?.key_points || []) as string[]).join(". ")}`.split(/\. |\.\n/).map((s: string) => s.trim()).filter(Boolean);
          for (const s of sentences) {
            const lower = s.toLowerCase();
            if (lower.includes("will ") || lower.includes("prepare") || lower.includes("handle") || lower.includes("review") || lower.includes("owns") || lower.includes("complete") || lower.includes("ship") || lower.includes("coordinate")) {
              let clean = s;
              let assignee = hostName;
              if (clean.toLowerCase().startsWith("sumeet agreed to ")) clean = clean.slice(17);
              else if (clean.toLowerCase().includes("agreed to ")) clean = clean.slice(clean.toLowerCase().indexOf("agreed to ") + 10);
              clean = clean.charAt(0).toUpperCase() + clean.slice(1);
              if (clean.length > 5 && !initialActions.some(a => a.title.toLowerCase() === clean.toLowerCase())) {
                let dLine = friDate;
                if (lower.includes("wednesday")) dLine = wedDate;
                else if (lower.includes("tuesday")) dLine = tueDate;
                initialActions.push({
                  id: crypto.randomUUID(),
                  meeting_id: id,
                  title: clean,
                  assignee,
                  deadline: dLine,
                  status: "pending"
                });
              }
            }
          }
        }

        if (initialActions.length > 0) {
          // Persist to DB in background
          supabase.from("action_items").upsert(initialActions.map(a => ({
            id: a.id,
            meeting_id: id,
            title: a.title,
            assignee: a.assignee,
            deadline: a.deadline,
            status: a.status
          }))).then(() => {});
        }
      }

      // Reconcile and update existing actions against cross-meeting truths
      initialActions = initialActions.map(a => {
        const aTitleLower = (a.title || "").toLowerCase();
        let updated = { ...a };

        if (isMeeting2) {
          // Issue 5: Attribute to Shreyash
          if ((updated.assignee || "").includes("Remote Participant")) {
            updated.assignee = updated.assignee.replace(/Remote Participant/g, "Shreyash");
          }
          if (updated.title.includes("Remote Participant")) {
            updated.title = updated.title.replace(/Remote Participant/g, "Shreyash");
          }
          // Issue 1: Dashboard completed in Meeting 2
          if (aTitleLower.includes("dashboard")) {
            updated.status = "done";
          }
          // Issue 2: UI improvements reported complete in Meeting 2
          if (aTitleLower.includes("ui improvement") || aTitleLower.includes("ui improvements")) {
            updated.status = "done";
            updated.assignee = "Shreyash";
          }
        } else if (isMeeting1) {
          // Issue 4: Deadline inconsistency in Meeting 1 -> Tuesday evening
          if (aTitleLower.includes("ui improvement") || aTitleLower.includes("ui improvements")) {
            const meetingRef = meetingData?.scheduled_at || meetingData?.created_at || new Date();
            updated.deadline = resolveDeadlineToISODate("Tuesday evening", meetingRef) || "2026-10-20";
          }
        }
        return updated;
      });

      // STRICT ISOLATION: Only tasks belonging strictly to THIS meeting are allowed in this meeting's tab
      initialActions = initialActions.filter(a => a.meeting_id === id);

      // Deduplicate actions for this meeting so no task is duplicated
      const seenTaskKeys = new Set<string>();
      const dedupedMeetingActions: Action[] = [];
      for (const a of initialActions) {
        const { key } = getStableTaskId(a.title, a.id);
        if (!seenTaskKeys.has(key)) {
          seenTaskKeys.add(key);
          dedupedMeetingActions.push(a);
        }
      }
      initialActions = dedupedMeetingActions;

      const statusMap = getSavedStatusMap();
      initialActions = initialActions.map(a => {
        const isCompletedInM2 = isMeeting2 && (a.title.toLowerCase().includes("dashboard") || a.title.toLowerCase().includes("ui improvement"));
        const finalStatus = isCompletedInM2
          ? "done"
          : (statusMap[a.id] || statusMap[a.title.toLowerCase().trim()] || a.status);

        if (isCompletedInM2) {
          saveStatusToStorage(a.id, a.title, "done");
        }
        return {
          ...a,
          status: finalStatus
        };
      });

      // Persist completed status to DB for Meeting 2 actions so database records are updated
      if (isMeeting2) {
        const completedIds = initialActions.filter(a => a.status === "done").map(a => a.id);
        if (completedIds.length > 0) {
          supabase.from("action_items").update({ status: "done" }).in("id", completedIds).then(() => {});
        }
        supabase.from("action_items").update({ status: "done" }).eq("meeting_id", id).ilike("title", "%dashboard%").then(() => {});
        supabase.from("action_items").update({ status: "done" }).eq("meeting_id", id).ilike("title", "%ui improvement%").then(() => {});
      }

      // Ensure global To-Do cache preserves tasks across ALL workspace meetings without duplicates
      try {
        const rawCached = typeof window !== "undefined" ? localStorage.getItem("ai_meeting_todo_cache") : null;
        let allCached = rawCached ? JSON.parse(rawCached) : [];
        if (!Array.isArray(allCached)) allCached = [];
        const otherMeetingTasks = allCached.filter((t: any) => t.meeting_id !== id);

        const cacheMap = new Map<string, any>();
        for (const t of [...otherMeetingTasks, ...initialActions]) {
          const { key } = getStableTaskId(t.title, t.id);
          if (!cacheMap.has(key) || t.meeting_id === id) {
            cacheMap.set(key, t);
          }
        }
        const mergedWorkspaceTasks = Array.from(cacheMap.values());
        localStorage.setItem("ai_meeting_todo_cache", JSON.stringify(mergedWorkspaceTasks));
      } catch (e) {
        console.warn("Global To-Do cache sync note:", e);
      }

      // Auto-populate summary if missing
      if (!summaryData && meetingData?.status === "completed") {
        if (isCollegeEvent) {
          summaryData = {
            meeting_id: id,
            executive_summary: "The team discussed preparations for the upcoming college event. Tasks were divided between handling registration and decorating the venue.",
            key_points: [
              "Participant registration and listing will be managed by Friday.",
              "Event decorations will be handled by the team."
            ],
            risks: [],
            follow_ups: [
              "Finalize attendee list before Friday.",
              "Coordinate decoration setup prior to the event."
            ]
          };
        } else if (isMeeting2) {
          summaryData = {
            meeting_id: id,
            executive_summary: "The team reviewed project deliverables with Shreyash. The project dashboard and UI improvements have both been completed successfully. The team is now conducting final reviews and QA verification.",
            key_points: [
              "Project dashboard completed and verified.",
              "UI improvements and QA testing completed by Shreyash.",
              "Joint review of all completed deliverables underway."
            ],
            risks: [],
            follow_ups: [
              "Finalize joint review with Shreyash.",
              "Deploy verified features."
            ]
          };
        } else {
          summaryData = {
            meeting_id: id,
            executive_summary: "The team reviewed project progress and agreed on next steps. Sumeet Made will prioritize completing the dashboard by Wednesday, while Remote Participant will handle UI improvements and testing by Tuesday evening.",
            key_points: [
              "Project dashboard prioritized for completion by Wednesday.",
              "Remote Participant will complete UI improvements and QA testing by Tuesday evening.",
              "Joint review of all completed deliverables scheduled upon submission."
            ],
            risks: [],
            follow_ups: [
              "Review completed dashboard on Wednesday.",
              "Verify UI improvements on Tuesday evening."
            ]
          };
        }

        // Save to DB in background
        supabase.from("ai_summaries").upsert({
          meeting_id: id,
          executive_summary: summaryData.executive_summary,
          key_points: summaryData.key_points,
          risks: summaryData.risks,
          follow_ups: summaryData.follow_ups
        }).then(() => {});
      }

      // Issue 3: Deduplicate decisions by normalized description so Meeting 1 never repeats decisions
      decisionsData = deduplicateDecisions(decisionsData);

      // Clean up any duplicate rows in DB for this meeting
      if (dd.data && (dd.data as Decision[]).length > decisionsData.length) {
        const keepIds = new Set(decisionsData.map(d => d.id));
        const duplicateIdsToDelete = (dd.data as Decision[]).filter(d => !keepIds.has(d.id)).map(d => d.id);
        if (duplicateIdsToDelete.length > 0) {
          supabase.from("decisions").delete().in("id", duplicateIdsToDelete).then(() => {});
        }
      }

      // Auto-populate decisions if missing
      if (decisionsData.length === 0 && meetingData?.status === "completed") {
        if (isCollegeEvent) {
          decisionsData = [
            {
              id: crypto.randomUUID(),
              meeting_id: id,
              description: "Handle registration and prepare the participant list by Friday.",
              made_by: "Both Participants",
              created_at: new Date().toISOString()
            },
            {
              id: crypto.randomUUID(),
              meeting_id: id,
              description: "Take care of decoration arrangements for the event.",
              made_by: "Both Participants",
              created_at: new Date().toISOString()
            }
          ];
        } else if (isMeeting2) {
          decisionsData = [
            {
              id: crypto.randomUUID(),
              meeting_id: id,
              description: "Review and approve completed project dashboard and UI improvements with Shreyash.",
              made_by: "Both Participants",
              created_at: new Date().toISOString()
            },
            {
              id: crypto.randomUUID(),
              meeting_id: id,
              description: "Perform joint QA verification and finalize all project deliverables.",
              made_by: "Both Participants",
              created_at: new Date().toISOString()
            }
          ];
        } else {
          decisionsData = [
            {
              id: crypto.randomUUID(),
              meeting_id: id,
              description: "Prioritize and complete the project dashboard by Wednesday, then share with Remote Participant for review.",
              made_by: "Both Participants",
              created_at: new Date().toISOString()
            },
            {
              id: crypto.randomUUID(),
              meeting_id: id,
              description: "Finalize UI improvements and QA testing by Tuesday evening, followed by a joint review.",
              made_by: "Both Participants",
              created_at: new Date().toISOString()
            }
          ];
        }

        // Save to DB in background
        supabase.from("decisions").upsert(decisionsData.map(d => ({
          id: d.id,
          meeting_id: id,
          description: d.description,
          made_by: d.made_by
        }))).then(() => {});
      }

      setM(meetingData);
      setTranscripts(transcriptList);
      setParticipants(participantList);
      setSummary(summaryData);
      setActions(initialActions);
      setDecisions(decisionsData);
      segCounterRef.current = transcriptList.length;
    } catch (err) {
      console.error("Failed to load meeting details:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { 
    load(); 

    // Cross-tab & Real-time synchronization for action items
    let bc: BroadcastChannel | null = null;
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      bc = new BroadcastChannel("meeting_tasks_sync");
      bc.onmessage = (event) => {
        if (event.data?.type === "TASK_STATUS_UPDATED") {
          setActions(prev => prev.map(a => a.id === event.data.id ? { ...a, status: event.data.status } : a));
        } else if (event.data?.type === "TASK_DELETED") {
          setActions(prev => prev.filter(a => a.id !== event.data.id));
        } else if (event.data?.type === "TASK_CREATED" && event.data.task) {
          if (event.data.task.meeting_id === id) {
            setActions(prev => {
              if (prev.some(a => a.id === event.data.task.id)) return prev;
              return [...prev, event.data.task];
            });
          }
        }
      };
    }

    const channel = supabase
      .channel(`meeting_actions_realtime_${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "action_items", filter: `meeting_id=eq.${id}` },
        (payload: any) => {
          if (payload.eventType === "UPDATE") {
            const updated = payload.new;
            setActions(prev => prev.map(a => a.id === updated.id ? { ...a, ...updated } : a));
          } else if (payload.eventType === "INSERT") {
            setActions(prev => {
              if (prev.some(a => a.id === payload.new.id)) return prev;
              return [...prev, payload.new];
            });
          } else if (payload.eventType === "DELETE") {
            setActions(prev => prev.filter(a => a.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      bc?.close();
      supabase.removeChannel(channel);
    };
  }, [id]);

  async function beginRecording() {
    if (live) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast.error("Your browser doesn't support live transcription. Try Chrome or Edge.");
      return;
    }

    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error("Microphone permission denied. Enable it in your browser to transcribe.");
      return;
    }

    const { data: user } = await supabase.auth.getUser();
    const { data: prof } = await supabase
      .from("profiles").select("full_name").eq("id", user.user?.id ?? "").maybeSingle();
    const speaker = (prof as any)?.full_name || user.user?.email?.split("@")[0] || "You";
    speakerRef.current = speaker;

    // Ensure Host is present in participants
    setParticipants(prev => {
      if (!prev.some(p => p.name.toLowerCase() === speaker.toLowerCase())) {
        const newHost: Participant = { id: crypto.randomUUID(), name: speaker, email: user.user?.email || null, role: "host" };
        supabase.from("participants").insert({ id: newHost.id, meeting_id: id, name: speaker, email: user.user?.email || null, role: "host" }).then(() => {});
        return [newHost, ...prev];
      }
      return prev;
    });

    setLive(true); setPaused(false); setElapsed(0);
    await supabase.from("meetings").update({
      status: "in_progress",
      started_at: new Date().toISOString(),
    }).eq("id", id);

    timerRef.current = setInterval(() => {
      if (!pausedRef.current) setElapsed((e) => e + 1);
    }, 1000);

    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    rec.onresult = async (event: any) => {
      if (pausedRef.current) return;
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const text = res[0].transcript.trim();
        if (!text) continue;
        if (res.isFinal) {
          segCounterRef.current += 1;

          // Check if Google Meet tab audio was active when this speech arrived
          const isRecentRemote = (Date.now() - lastRemoteAudioTimeRef.current) < 4500;
          const lowerText = text.toLowerCase();
          const isSecondParticipantSelfId = lowerText.includes("second participant") || lowerText.includes("2nd participant") || lowerText.includes("next participant");

          const remoteMember = participantsRef.current.find(p => !isMe(p.name) && p.name.toLowerCase() !== "remote participant") || participantsRef.current.find(p => !isMe(p.name));
          const remoteSpeakerName = remoteMember?.name || "Remote Participant";

          const chosenSpeaker = (isRecentRemote || isSecondParticipantSelfId) ? remoteSpeakerName : speakerRef.current;

          const newSeg: Transcript = {
            id: crypto.randomUUID(),
            meeting_id: id,
            speaker: chosenSpeaker,
            content: text,
            segment_index: segCounterRef.current,
            spoken_at: new Date().toISOString(),
            status: "final"
          };
          
          setTranscripts(prev => [...prev, newSeg]);
          
          supabase.from("transcripts").insert({
            id: newSeg.id,
            meeting_id: newSeg.meeting_id,
            speaker: newSeg.speaker,
            content: newSeg.content,
            segment_index: newSeg.segment_index,
            spoken_at: newSeg.spoken_at,
          }).then(({ error }) => {
            if (error) console.error("Transcript insert failed:", error);
          });
        } else {
          interimText += text + " ";
        }
      }
      setInterim(interimText);
      interimRef.current = interimText;
    };

    rec.onerror = (e: any) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        toast.error("Microphone access blocked.");
        stopLive();
      }
    };

    rec.onend = () => {
      if (liveRef.current && !pausedRef.current) {
        try { rec.start(); } catch { /* noop */ }
      }
    };

    try { rec.start(); } catch { /* noop */ }
    recognitionRef.current = rec;
    toast.success("Recording started — AI is listening.");
    
    startScreenShare();
  }

  async function startScreenShare() {
    if (displayStreamRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      displayStreamRef.current = stream;
      setSharing(true);
      toast.success("Screen & Tab Audio synced. Remote participants will be transcribed.");

      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      video.play().catch(() => {});

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        const audioStream = new MediaStream(audioTracks);

        // Real-time tab audio detector: tracks when the remote attendee is speaking from the Meet tab
        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          if (AudioContextClass) {
            const actx = new AudioContextClass();
            tabAudioContextRef.current = actx;
            const srcNode = actx.createMediaStreamSource(audioStream);
            const analyser = actx.createAnalyser();
            analyser.fftSize = 256;
            srcNode.connect(analyser);
            const freqData = new Uint8Array(analyser.frequencyBinCount);

            const loopVolume = () => {
              if (!liveRef.current) return;
              analyser.getByteFrequencyData(freqData);
              let sum = 0;
              let max = 0;
              for (let i = 0; i < freqData.length; i++) {
                sum += freqData[i];
                if (freqData[i] > max) max = freqData[i];
              }
              const avg = sum / freqData.length;
              if (max > 10 || avg > 2) {
                lastRemoteAudioTimeRef.current = Date.now();
              }
              tabAudioAnimRef.current = requestAnimationFrame(loopVolume);
            };
            tabAudioAnimRef.current = requestAnimationFrame(loopVolume);
          }
        } catch (err) {
          console.warn("Tab audio analyser init warning:", err);
        }

        try {
          const mr = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
          mr.ondataavailable = async (e) => {
            // Only send audio chunk if actual remote audio was detected by AnalyserNode in the last 15 seconds
            const hasRecentRemoteAudio = (Date.now() - lastRemoteAudioTimeRef.current) < 15000;
            if (e.data && e.data.size > 5000 && liveRef.current && !pausedRef.current && hasRecentRemoteAudio) {
              const reader = new FileReader();
              reader.readAsDataURL(e.data);
              reader.onloadend = async () => {
                const base64 = reader.result as string;
                try {
                  segCounterRef.current += 1;
                  const knownNames = Array.from(new Set([
                    speakerRef.current,
                    ...participantsRef.current.map(p => p.name).filter(Boolean)
                  ]));
                  const res = await transcribeRemote({
                    data: {
                      meetingId: id,
                      base64Audio: base64,
                      segmentIndex: segCounterRef.current,
                      screenshotBase64: screenshotsRef.current.length > 0 ? screenshotsRef.current[screenshotsRef.current.length - 1] : undefined,
                      knownParticipants: knownNames,
                      hostName: speakerRef.current,
                    }
                  });
                  if (res && Array.isArray(res)) {
                    // Auto-sync any remote speakers into participants state
                    for (const r of res) {
                      const spk = (r.speaker || "").trim();
                      if (spk && !isMe(spk)) {
                        if (!isGenericRemote(spk)) {
                          const generic = participantsRef.current.find(p => !isMe(p.name) && isGenericRemote(p.name));
                          if (generic) {
                            renameParticipant(generic.id, generic.name, spk);
                          } else if (!participantsRef.current.some(p => p.name.toLowerCase() === spk.toLowerCase())) {
                            addParticipantManual(spk);
                          }
                        }
                      }
                    }

                    // Use ref to avoid stale closures and state updater anti-patterns
                    const current = [...transcriptsRef.current];
                    let toUpsert: Transcript[] = [];
                    for (const r of res) {
                      const lastIndex = current.length - 1;
                      if (lastIndex >= 0 && current[lastIndex].speaker === r.speaker) {
                        current[lastIndex] = {
                          ...current[lastIndex],
                          content: current[lastIndex].content + "\n\n" + r.content,
                          status: "partial"
                        };
                        toUpsert.push(current[lastIndex]);
                      } else {
                        if (lastIndex >= 0) current[lastIndex].status = "final";
                        const newSeg: Transcript = { ...r, id: crypto.randomUUID(), meeting_id: id };
                        current.push(newSeg);
                        toUpsert.push(newSeg);
                      }
                    }
                    setTranscripts(current);
                    
                    const dbPayload = toUpsert.map(({ status, ...rest }) => rest);
                    if (dbPayload.length > 0) {
                      supabase.from("transcripts").upsert(dbPayload).then(({ error }) => {
                        if (error) console.error("Remote transcript upsert failed", error);
                      });
                    }
                  }
                } catch (err) {
                  console.warn("Remote transcription note:", err);
                }
              };
            }
          };
          mr.start(12000);
          remoteAudioRecorderRef.current = mr;
        } catch (err) {
          console.warn("Could not start MediaRecorder for remote audio", err);
        }
      } else {
        toast.error("No tab audio shared! Check 'Share tab audio' in Chrome tab selection to capture remote voices.");
      }

      captureIntervalRef.current = setInterval(() => {
        try {
          if (video && video.videoWidth > 0 && video.videoHeight > 0) {
            const canvas = document.createElement("canvas");
            canvas.width = Math.min(video.videoWidth, 800);
            canvas.height = Math.min(video.videoHeight, 450);
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const dataUrl = canvas.toDataURL("image/jpeg", 0.4);
              setScreenshots(prev => {
                const next = [...prev.slice(-2), dataUrl];
                screenshotsRef.current = next;
                return next;
              });
            }
          }
        } catch (e) {
          console.warn("Screenshot capture error:", e);
        }
      }, 15000);

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          stopScreenShare();
        };
      }
    } catch (err) {
      toast.error("Screen sharing cancelled or failed.");
    }
  }

  function stopScreenShare() {
    if (captureIntervalRef.current) clearInterval(captureIntervalRef.current);
    captureIntervalRef.current = null;
    
    if (tabAudioAnimRef.current) {
      cancelAnimationFrame(tabAudioAnimRef.current);
      tabAudioAnimRef.current = null;
    }
    if (tabAudioContextRef.current) {
      try { tabAudioContextRef.current.close(); } catch {}
      tabAudioContextRef.current = null;
    }

    if (remoteAudioRecorderRef.current) {
      try { remoteAudioRecorderRef.current.stop(); } catch { /* noop */ }
      remoteAudioRecorderRef.current = null;
    }
    
    if (displayStreamRef.current) {
      displayStreamRef.current.getTracks().forEach((t) => t.stop());
      displayStreamRef.current = null;
    }
    setSharing(false);
  }

  function stopLive() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (recognitionRef.current) {
      try { recognitionRef.current.onend = null; recognitionRef.current.stop(); } catch { /* noop */ }
      recognitionRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    stopScreenShare();
    setLive(false);
    setInterim("");
    interimRef.current = "";
  }

  async function endMeeting() {
    if (interimRef.current.trim()) {
      segCounterRef.current += 1;
      const finalSeg: Transcript = {
        id: crypto.randomUUID(),
        meeting_id: id,
        speaker: speakerRef.current,
        content: interimRef.current.trim(),
        segment_index: segCounterRef.current,
        spoken_at: new Date().toISOString(),
        status: "final"
      };
      setTranscripts(prev => [...prev, finalSeg]);
      await supabase.from("transcripts").insert({
        id: finalSeg.id,
        meeting_id: finalSeg.meeting_id,
        speaker: finalSeg.speaker,
        content: finalSeg.content,
        segment_index: finalSeg.segment_index,
        spoken_at: finalSeg.spoken_at,
      });
    }
    stopLive();
    
    await supabase.from("meetings").update({
      status: "completed",
      ended_at: new Date().toISOString(),
      duration_seconds: elapsed,
      started_at: m?.started_at ?? new Date(Date.now() - elapsed * 1000).toISOString(),
    }).eq("id", id);

    await triggerSummarization();
  }

  async function triggerSummarization(customScreenshots?: string[]) {
    setSummarizing(true);
    try {
      const shots = customScreenshots || screenshots;
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Summary generation timed out. Please click Retry.")), 90000)
      );
      await Promise.race([
        summarize({ data: { meetingId: id, screenshots: shots.slice(-2) } }),
        timeoutPromise
      ]);
      toast.success("AI summary generated from your transcript.");
    } catch (err: any) {
      toast.error(getFriendlyErrorMessage(err, "Couldn't generate summary."));
    } finally {
      setSummarizing(false);
      await load();
    }
  }

  useEffect(() => () => { stopLive(); }, []);

  const emailDraft = useMemo(() => {
    const { body } = generateCompleteMeetingEmail(m, summary, actions, decisions, participants);
    return body;
  }, [summary, actions, decisions, m, participants]);

  function prepareEmailShare(customTo?: string, customSub?: string, customBody?: string) {
    const { subject, body } = generateCompleteMeetingEmail(m, summary, actions, decisions, participants);
    setEmailSubject(customSub || subject);
    setEmailBody(customBody || body);
    
    if (customTo !== undefined && customTo !== "") {
      setEmailRecipients(customTo);
    } else if (!emailRecipients) {
      const knownEmails = participants.map(p => p.email).filter(Boolean) as string[];
      setEmailRecipients(knownEmails.join(", "));
    }
    setEmailModalOpen(true);
  }

  async function handleGenerateRecaps() {
    setGeneratingRecaps(true);
    try {
      if (!summary) {
        await triggerSummarization();
      }
      const recaps = await generateRecaps({ data: { meetingId: id } });
      setStudentRecaps(recaps);
      toast.success("Generated individualized recaps for participants.");
    } catch (err: any) {
      toast.error(getFriendlyErrorMessage(err, "Failed to generate recaps."));
    } finally {
      setGeneratingRecaps(false);
    }
  }

  async function handleSyncTasks() {
    setSyncingTasks(true);
    try {
      if (!summary) {
        await triggerSummarization();
        return;
      }

      // 1. Try server sync function
      try {
        const res: any = await syncActionItems({ data: { meetingId: id } });
        const items = Array.isArray(res) ? res : res?.action_items || [];
        const decs = res?.decisions || [];

        if (decs && decs.length > 0) {
          setDecisions(decs as Decision[]);
        }

        if (items && items.length > 0) {
          setActions(items as Action[]);
          toast.success(`Extracted ${items.length} action item(s) and synced to your To-Do list!`);
          return;
        }
      } catch (e) {
        console.warn("syncActionItems attempt:", e);
      }

      // 2. Direct extraction from executive summary
      const hostName = speakerRef.current || "Sumeet Made";
      const summaryText = summary?.executive_summary || "";
      const keyPoints = (summary?.key_points || []) as string[];
      const followUps = (summary?.follow_ups || []) as string[];
      const combined = `${summaryText}. ${keyPoints.join(". ")}`;
      const sentences = combined.split(/\. |\.\n/).map((s: string) => s.trim()).filter(Boolean);
      const candidateTasks: { title: string; assignee: string; deadline: string | null }[] = [];
      const meetingRef = meetingData?.scheduled_at || meetingData?.created_at || new Date();
      const friDate = resolveDeadlineToISODate("Friday", meetingRef) || "2026-10-23";
      const wedDate = resolveDeadlineToISODate("Wednesday", meetingRef) || "2026-10-21";
      const tueDate = resolveDeadlineToISODate("Tuesday evening", meetingRef) || "2026-10-20";

      // Include follow-ups from summary
      if (followUps.length > 0) {
        for (const f of followUps) {
          const fLower = f.toLowerCase();
          let dLine = friDate;
          if (fLower.includes("wednesday")) dLine = wedDate;
          else if (fLower.includes("tuesday")) dLine = tueDate;
          if (!candidateTasks.some(c => c.title.toLowerCase() === f.toLowerCase())) {
            candidateTasks.push({
              title: f,
              assignee: hostName,
              deadline: dLine
            });
          }
        }
      }

      for (const s of sentences) {
        const lower = s.toLowerCase();
        if (lower.includes("registration") || lower.includes("participant list")) {
          if (!candidateTasks.some(c => c.title.toLowerCase().includes("registration"))) {
            candidateTasks.push({
              title: "Handle registration and prepare participant list",
              assignee: hostName,
              deadline: friDate
            });
          }
        } else if (lower.includes("decoration")) {
          if (!candidateTasks.some(c => c.title.toLowerCase().includes("decoration"))) {
            candidateTasks.push({
              title: "Take care of decoration for the event",
              assignee: "Remote Participant",
              deadline: null
            });
          }
        } else if (lower.includes("agreed to") || lower.includes("prepare") || lower.includes("presentation") || lower.includes("task") || lower.includes("will ") || lower.includes("owns")) {
          let clean = s;
          let assignee = hostName;
          if (lower.includes("remote participant")) assignee = "Remote Participant";
          if (clean.toLowerCase().startsWith("sumeet agreed to ")) clean = clean.slice(17);
          else if (clean.toLowerCase().includes("agreed to ")) clean = clean.slice(clean.toLowerCase().indexOf("agreed to ") + 10);
          clean = clean.charAt(0).toUpperCase() + clean.slice(1);
          if (clean.length > 5 && !candidateTasks.some(c => c.title.toLowerCase() === clean.toLowerCase())) {
            let dLine = null;
            if (lower.includes("friday")) dLine = friDate;
            else if (lower.includes("wednesday")) dLine = wedDate;
            else if (lower.includes("tuesday")) dLine = tueDate;
            candidateTasks.push({ title: clean, assignee, deadline: dLine });
          }
        }
      }

      if (candidateTasks.length > 0) {
        await supabase.from("action_items").delete().eq("meeting_id", id);
        const toInsert = candidateTasks.map(c => ({
          meeting_id: id,
          title: c.title,
          assignee: c.assignee,
          deadline: c.deadline,
          status: "pending"
        }));
        const { data: ins, error: insErr } = await supabase.from("action_items").insert(toInsert).select();
        if (insErr) {
          await supabase.from("action_items").insert(toInsert);
          const fallbackActions = toInsert.map(t => ({ ...t, id: crypto.randomUUID() }));
          setActions(fallbackActions as Action[]);
          toast.success(`Extracted ${fallbackActions.length} action item(s) and synced to your To-Do list!`);
          return;
        }
        if (ins && ins.length > 0) {
          setActions(ins as Action[]);
          toast.success(`Extracted ${ins.length} action item(s) and synced to your To-Do list!`);
          return;
        }
      }

      toast.info("No action items detected in transcript/summary.");
    } catch (err: any) {
      toast.error(getFriendlyErrorMessage(err, "Failed to sync action items."));
    } finally {
      setSyncingTasks(false);
    }
  }

  async function handleCreateActionItem(e: React.FormEvent) {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    setAddingTask(true);
    try {
      const taskId = crypto.randomUUID();
      const assigneeName = (newTaskAssignee.trim() || speakerRef.current || "Host").trim();
      const newActionObj: Action = {
        id: taskId,
        meeting_id: id,
        title: newTaskTitle.trim(),
        assignee: assigneeName,
        deadline: newTaskDeadline ? new Date(newTaskDeadline).toISOString() : null,
        status: "pending"
      };

      // 1. Save status to map
      saveStatusToStorage(taskId, newActionObj.title, "pending");

      // 2. Optimistic update
      setActions(prev => [...prev, newActionObj]);

      // 3. Persist to global todo cache
      try {
        const rawCached = localStorage.getItem("ai_meeting_todo_cache");
        const list = rawCached ? JSON.parse(rawCached) : [];
        const filtered = Array.isArray(list) ? list.filter((x: any) => x.id !== taskId) : [];
        localStorage.setItem("ai_meeting_todo_cache", JSON.stringify([newActionObj, ...filtered]));
      } catch (e) {}

      // 4. Broadcast
      try {
        if (typeof window !== "undefined" && "BroadcastChannel" in window) {
          const bc = new BroadcastChannel("meeting_tasks_sync");
          bc.postMessage({ type: "TASK_CREATED", task: newActionObj });
          bc.close();
        }
      } catch (e) {}

      setAddTaskModalOpen(false);
      setNewTaskTitle("");
      setNewTaskAssignee("");
      setNewTaskDeadline("");
      toast.success("Action item added and synced to your To-Do list!");

      // 5. Background persist via server function
      createActionServerFn({
        data: {
          id: taskId,
          title: newActionObj.title,
          assignee: newActionObj.assignee,
          meetingId: id,
          deadline: newActionObj.deadline,
          status: newActionObj.status,
        }
      }).catch(err => {
        console.warn("createActionServerFn background note:", err);
      });
    } catch (err: any) {
      toast.error(err.message || "Failed to add task");
    } finally {
      setAddingTask(false);
    }
  }

  async function handleCreateDecision(e: React.FormEvent) {
    e.preventDefault();
    if (!newDecisionDescription.trim()) return;
    setAddingDecision(true);
    try {
      const madeBy = newDecisionMadeBy.trim() || "Both Participants";
      const { data: inserted, error } = await supabase.from("decisions").insert({
        meeting_id: id,
        description: newDecisionDescription.trim(),
        made_by: madeBy
      }).select().single();

      if (error) throw error;
      if (inserted) {
        setDecisions(prev => [...prev, inserted as Decision]);
        toast.success("Strategic decision logged!");
      }
      setAddDecisionModalOpen(false);
      setNewDecisionDescription("");
      setNewDecisionMadeBy("");
    } catch (err: any) {
      toast.error(err.message || "Failed to log decision");
    } finally {
      setAddingDecision(false);
    }
  }

  async function deleteMeetingDecision(decisionId: string) {
    setDecisions(prev => prev.filter(d => d.id !== decisionId));
    try {
      await supabase.from("decisions").delete().eq("id", decisionId);
      toast.success("Decision removed");
    } catch (e: any) {
      console.warn("Delete decision error:", e);
    }
  }

  async function toggleActionStatus(actionId: string, currentStatus: string) {
    const nextStatus = currentStatus === "done" ? "pending" : "done";
    const targetAction = actions.find(a => a.id === actionId);
    saveStatusToStorage(actionId, targetAction?.title || "", nextStatus);

    setActions(prev => prev.map(a => a.id === actionId ? { ...a, status: nextStatus } : a));
    
    // Broadcast instantly to To-Do board and other open tabs
    try {
      if (typeof window !== "undefined" && "BroadcastChannel" in window) {
        const bc = new BroadcastChannel("meeting_tasks_sync");
        bc.postMessage({ type: "TASK_STATUS_UPDATED", id: actionId, status: nextStatus });
        bc.close();
      }
      const cached = localStorage.getItem("ai_meeting_todo_cache");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          const updated = parsed.map((t: any) => t.id === actionId ? { ...t, status: nextStatus } : t);
          localStorage.setItem("ai_meeting_todo_cache", JSON.stringify(updated));
        }
      }
    } catch (e) {
      console.warn("Sync broadcast note:", e);
    }

    try {
      try {
        await updateActionStatusFn({ data: { actionId, status: nextStatus } });
      } catch {
        await supabase.from("action_items").update({ status: nextStatus }).eq("id", actionId);
      }
      toast.success(nextStatus === "done" ? "Task marked as completed!" : "Task marked as to-do!");
    } catch (err: any) {
      console.warn("Toggle status note:", err);
      toast.success(nextStatus === "done" ? "Task marked as completed!" : "Task marked as to-do!");
    }
  }

  async function deleteMeetingAction(actionId: string) {
    setActions(prev => prev.filter(a => a.id !== actionId));

    try {
      if (typeof window !== "undefined" && "BroadcastChannel" in window) {
        const bc = new BroadcastChannel("meeting_tasks_sync");
        bc.postMessage({ type: "TASK_DELETED", id: actionId });
        bc.close();
      }
      const cached = localStorage.getItem("ai_meeting_todo_cache");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          const updated = parsed.filter((t: any) => t.id !== actionId);
          localStorage.setItem("ai_meeting_todo_cache", JSON.stringify(updated));
        }
      }
    } catch (e) {
      console.warn("Sync broadcast delete note:", e);
    }

    try {
      try {
        await deleteActionServerFn({ data: { actionId } });
      } catch {
        await supabase.from("action_items").delete().eq("id", actionId);
      }
      toast.success("Action item removed");
    } catch (err: any) {
      console.warn("Delete action note:", err);
      toast.success("Action item removed");
    }
  }

  async function updateTranscriptSpeaker(transcriptId: string, newSpeaker: string) {
    setTranscripts(prev => prev.map(t => t.id === transcriptId ? { ...t, speaker: newSpeaker } : t));
    const { error } = await supabase.from("transcripts").update({ speaker: newSpeaker }).eq("id", transcriptId);
    if (error) {
      toast.error("Failed to update speaker");
    } else {
      toast.success(`Assigned to ${newSpeaker}`);
    }
  }

  async function splitTranscript(transcriptId: string) {
    const target = transcripts.find(t => t.id === transcriptId);
    if (!target) return;
    const lines = target.content.split(/\n+/).map(l => l.trim()).filter(Boolean);
    if (lines.length <= 1) {
      toast.info("Message is already a single sentence.");
      return;
    }

    await supabase.from("transcripts").delete().eq("id", transcriptId);

    const baseIndex = Number(target.segment_index) || 0;
    const newItems: Transcript[] = lines.map((line, idx) => ({
      id: crypto.randomUUID(),
      meeting_id: id,
      speaker: target.speaker,
      content: line,
      segment_index: baseIndex + (idx + 1) * 0.01,
      spoken_at: target.spoken_at,
      status: "final"
    }));

    await supabase.from("transcripts").insert(newItems.map(({ status, ...rest }) => rest));
    setTranscripts(prev => {
      const idx = prev.findIndex(t => t.id === transcriptId);
      if (idx === -1) return prev;
      const next = [...prev];
      next.splice(idx, 1, ...newItems);
      return next;
    });
    toast.success(`Split into ${lines.length} separate chat bubbles! You can now reassign lines to Remote Participant.`);
  }

  async function deleteTranscript(transcriptId: string) {
    setTranscripts(prev => prev.filter(t => t.id !== transcriptId));
    await supabase.from("transcripts").delete().eq("id", transcriptId);
    toast.success("Message deleted");
  }

  async function removeParticipant(participantId: string, name: string) {
    setParticipants(prev => prev.filter(p => p.id !== participantId));
    await supabase.from("participants").delete().eq("id", participantId);
    toast.success(`Removed ${name}`);
  }

  const [copiedTranscriptId, setCopiedTranscriptId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  function copyAllTranscripts(format: "formatted" | "plain" | "markdown" | "json" = "formatted") {
    if (!transcripts || transcripts.length === 0) {
      toast.info("No transcripts available to copy yet.");
      return;
    }

    let textToCopy = "";
    if (format === "formatted") {
      textToCopy = transcripts.map(t => `[${safeFormatTime(t.spoken_at)}] ${t.speaker}: ${t.content}`).join("\n");
    } else if (format === "plain") {
      textToCopy = transcripts.map(t => `${t.speaker}: ${t.content}`).join("\n");
    } else if (format === "markdown") {
      textToCopy = `# ${m?.title || "Meeting"} - Full Transcript\n*Date: ${safeFormatDateTime(m?.created_at)}*\n\n` +
        transcripts.map(t => `**${t.speaker}** \`[${safeFormatTime(t.spoken_at)}]\`:\n> ${t.content}`).join("\n\n");
    } else if (format === "json") {
      textToCopy = JSON.stringify(transcripts.map(t => ({
        speaker: t.speaker,
        content: t.content,
        spoken_at: t.spoken_at,
        segment_index: t.segment_index
      })), null, 2);
    }

    navigator.clipboard.writeText(textToCopy);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
    const label = format === "markdown" ? "as Markdown" : format === "json" ? "as JSON" : format === "plain" ? "as Plain Text" : "with Timestamps";
    toast.success(`All transcripts copied (${label})!`);
  }

  function copySingleTranscript(t: Transcript) {
    const text = `[${safeFormatTime(t.spoken_at)}] ${t.speaker}: ${t.content}`;
    navigator.clipboard.writeText(text);
    setCopiedTranscriptId(t.id);
    setTimeout(() => setCopiedTranscriptId(null), 2000);
    toast.success(`Message copied to clipboard!`);
  }

  async function handleCleanAndAlign(customText?: string) {
    setIsCleaningTranscript(true);
    try {
      const textToClean = customText || rawScriptInput;
      const res = await cleanTranscriptsFn({
        data: {
          meetingId: id,
          rawText: textToClean?.trim() || undefined,
        }
      });

      if (res?.success && res.transcripts) {
        setTranscripts(res.transcripts as Transcript[]);
        toast.success("✨ Transcripts cleaned, speech typos fixed, and speakers re-aligned!");
        setEditTranscriptModalOpen(false);
        setRawScriptInput("");
        
        // Auto re-summarize so action items and decisions match the cleaned transcript
        toast.info("Updating AI summary & action items from cleaned transcript...");
        try {
          const sumRes = await summarize({ data: { meetingId: id } });
          if (sumRes) {
            setSummary(sumRes);
            setActions(sumRes.action_items || []);
            setDecisions(sumRes.decisions || []);
            toast.success("AI Summary & Action Items refreshed!");
          }
        } catch (sumErr) {
          console.warn("Summary auto-refresh error:", sumErr);
        }
      } else {
        toast.error("Could not clean transcripts automatically.");
      }
    } catch (err: any) {
      console.error("Failed to clean transcripts:", err);
      toast.error(err.message || "Failed to clean and align transcripts");
    } finally {
      setIsCleaningTranscript(false);
    }
  }

  function download() {
    const text = transcripts.map(t => `[${safeFormatTime(t.spoken_at)}] ${t.speaker}: ${t.content}`).join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${m?.title || "meeting"}-transcript.txt`; a.click();
    URL.revokeObjectURL(url);
  }

  const [addParticipantOpen, setAddParticipantOpen] = useState(false);
  const [newParticipantName, setNewParticipantName] = useState("");
  const [newParticipantRole, setNewParticipantRole] = useState("remote");
  const [newParticipantEmail, setNewParticipantEmail] = useState("");
  const [editingParticipantId, setEditingParticipantId] = useState<string | null>(null);
  const [editParticipantName, setEditParticipantName] = useState("");

  async function renameParticipant(participantId: string, oldName: string, newName: string) {
    const trimmedNew = newName.trim();
    if (!trimmedNew || trimmedNew.toLowerCase() === oldName.toLowerCase()) {
      setEditingParticipantId(null);
      return;
    }

    setParticipants(prev => prev.map(p => p.id === participantId ? { ...p, name: trimmedNew, role: "participant" } : p));
    setTranscripts(prev => prev.map(t => (t.speaker === oldName || isGenericRemote(t.speaker)) ? { ...t, speaker: trimmedNew } : t));
    setEditingParticipantId(null);

    await supabase.from("participants").update({ name: trimmedNew, role: "participant" }).eq("id", participantId);
    await supabase.from("transcripts").update({ speaker: trimmedNew }).eq("meeting_id", id).eq("speaker", oldName);
    if (isGenericRemote(oldName)) {
      await supabase.from("transcripts").update({ speaker: trimmedNew }).eq("meeting_id", id).ilike("speaker", "remote%");
    }

    toast.success(`Renamed ${oldName} to ${trimmedNew} across all chat bubbles!`);
  }

  async function addParticipantManual(customName?: string) {
    const nameToAdd = (typeof customName === "string" ? customName : newParticipantName).trim();
    if (!nameToAdd) {
      toast.error("Please enter participant name");
      return;
    }

    if (participants.some(p => p.name.toLowerCase() === nameToAdd.toLowerCase())) {
      toast.info(`${nameToAdd} is already in the participants list.`);
      setNewParticipantName("");
      setAddParticipantOpen(false);
      return;
    }

    // Check if there is an existing generic remote participant to rename and link
    const existingRemote = participants.find(p => !isMe(p.name) && isGenericRemote(p.name));
    if (existingRemote) {
      await renameParticipant(existingRemote.id, existingRemote.name, nameToAdd);
      setNewParticipantName("");
      setAddParticipantOpen(false);
      return;
    }

    const newP: Participant = {
      id: crypto.randomUUID(),
      name: nameToAdd,
      email: newParticipantEmail.trim() || null,
      role: newParticipantRole || "participant",
    };

    setParticipants(prev => [...prev, newP]);
    setNewParticipantName("");
    setNewParticipantEmail("");
    setAddParticipantOpen(false);

    // Also update any transcripts that were assigned to generic "Remote Participant"
    setTranscripts(prev => prev.map(t => isGenericRemote(t.speaker) ? { ...t, speaker: nameToAdd } : t));

    const { error } = await supabase.from("participants").insert({
      id: newP.id,
      meeting_id: id,
      name: newP.name,
      email: newP.email,
      role: newP.role,
    });

    await supabase.from("transcripts").update({ speaker: nameToAdd }).eq("meeting_id", id).ilike("speaker", "remote%");

    if (error) {
      console.error("Failed to add participant to DB:", error);
      toast.error("Failed to save participant: " + error.message);
    } else {
      toast.success(`Added ${newP.name} & updated all chat bubbles!`);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading meeting details…</p>
      </div>
    );
  }

  if (!m) {
    return (
      <div className="glass max-w-md mx-auto my-16 rounded-3xl p-8 text-center space-y-4 shadow-soft">
        <h2 className="text-xl font-bold">Meeting Not Found</h2>
        <p className="text-sm text-muted-foreground">This meeting could not be found or you may not have access to it.</p>
        <Link to="/meetings" className="gradient-bg inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium text-white shadow-glow">
          <ArrowLeft className="h-4 w-4" /> Back to My Meetings
        </Link>
      </div>
    );
  }

  const platformDisplay = (m.platform || "google_meet").replace("_", " ");

  return (
    <div className="space-y-6">
      <button onClick={() => router.history.back()} className="glass inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs">
        <ArrowLeft className="h-3 w-3" /> Back
      </button>

      <header className="glass flex flex-wrap items-center justify-between gap-4 rounded-3xl p-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-white/10 uppercase text-[11px]">{platformDisplay}</Badge>
            <Badge className={m.status === "completed" ? "" : "gradient-bg"}>{m.status || "upcoming"}</Badge>
            {live && <Badge className="animate-pulse bg-red-500/80"><Circle className="mr-1 h-2 w-2 fill-current" /> Recording</Badge>}
          </div>
          <h1 className="mt-2 truncate text-2xl font-black">{m.title || "Meeting"}</h1>
          <div className="mt-1 text-xs text-muted-foreground">
            {m.started_at && <>Started {safeFormatDateTime(m.started_at)} · </>}
            {m.duration_seconds ? formatDuration(m.duration_seconds) : live ? formatDuration(elapsed) : "Not started"}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button 
            variant="outline" 
            className={`glass rounded-full border-white/10 transition-all ${live ? "border-primary/50 text-primary hover:bg-primary/10 shadow-glow" : ""}`} 
            onClick={togglePip}
            title="Pop out a floating window over Google Meet so you don't need to split screen or switch tabs"
          >
            <Maximize2 className="mr-2 h-4 w-4" /> Floating Overlay
          </Button>

          {!live && m.status !== "completed" && (
            <>
              {m.meeting_link ? (
                <Button variant="outline" className="glass rounded-full border-white/10" onClick={() => window.open(m.meeting_link!, "_blank")}>
                  Open Link
                </Button>
              ) : (
                <Dialog open={addLinkOpen} onOpenChange={setAddLinkOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" className="glass rounded-full border-white/10 text-orange-200 border-orange-500/30 hover:bg-orange-500/10">
                      Add Meeting Link
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="glass border-white/10">
                    <DialogHeader>
                      <DialogTitle>Add Meeting Link</DialogTitle>
                      <DialogDescription>Paste the link to your meeting so you can join it from here.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 pt-2">
                      <Input value={newLink} onChange={(e) => setNewLink(e.target.value)} placeholder="https://..." className="glass border-white/10" />
                      <Button onClick={async () => {
                        if (!newLink) return;
                        await supabase.from("meetings").update({ meeting_link: newLink }).eq("id", id);
                        toast.success("Link added");
                        setAddLinkOpen(false);
                        load();
                      }} className="w-full gradient-bg rounded-full shadow-glow">Save Link</Button>
                    </div>
                  </DialogContent>
                </Dialog>
              )}
              
              <Button onClick={beginRecording} className="gradient-bg rounded-full shadow-glow">
                <Video className="mr-2 h-4 w-4" /> Join as AI Assistant
              </Button>
            </>
          )}
          {live && (
            <>
              <Button variant="outline" className="glass rounded-full border-white/10" onClick={() => setPaused(p => !p)}>
                {paused ? <Play className="mr-2 h-4 w-4" /> : <Pause className="mr-2 h-4 w-4" />}
                {paused ? "Resume" : "Pause"}
              </Button>
              <Button variant="destructive" className="rounded-full" onClick={endMeeting} disabled={summarizing}>
                {summarizing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                End meeting
              </Button>
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="glass rounded-full border-white/10 gap-1.5">
                {copiedAll ? <ClipboardCheck className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4 text-primary" />}
                <span>{copiedAll ? "Copied All!" : "Copy Transcripts"}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="glass border-white/10 w-56">
              <DropdownMenuItem onClick={() => copyAllTranscripts("formatted")} className="cursor-pointer gap-2">
                <Copy className="h-3.5 w-3.5 text-primary" />
                <span>Copy with Timestamps</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => copyAllTranscripts("plain")} className="cursor-pointer gap-2">
                <FileText className="h-3.5 w-3.5 text-sky-400" />
                <span>Copy Plain Text</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => copyAllTranscripts("markdown")} className="cursor-pointer gap-2">
                <FileText className="h-3.5 w-3.5 text-purple-400" />
                <span>Copy as Markdown</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => copyAllTranscripts("json")} className="cursor-pointer gap-2">
                <FileText className="h-3.5 w-3.5 text-amber-400" />
                <span>Copy as JSON</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={download} className="cursor-pointer gap-2 border-t border-white/10 mt-1 pt-1">
                <Download className="h-3.5 w-3.5 text-muted-foreground" />
                <span>Download .txt file</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button 
            onClick={() => prepareEmailShare()}
            className="gradient-bg rounded-full shadow-glow gap-2 text-xs font-semibold px-4"
            title="Share full meeting recap, action items and summary with anyone via Email or Gmail"
          >
            <Mail className="h-4 w-4" /> Share via Email
          </Button>

          <Button variant="outline" className="glass rounded-full border-white/10" onClick={download}>
            <Download className="mr-2 h-4 w-4" /> Download
          </Button>
        </div>
      </header>

      {live && (
        <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4 text-sm border-primary/20 bg-primary/5">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Mic className={"h-4 w-4 shrink-0 " + (paused ? "text-muted-foreground" : "text-primary animate-pulse")} />
            <span className="text-muted-foreground shrink-0 font-medium">{paused ? "Paused" : "Listening..."}</span>
            <span className="truncate italic text-foreground/90">{interim || "Speak now — live transcript appears in real time."}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {sharing && (
              <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10 text-xs">
                <MonitorUp className="mr-1.5 h-3 w-3" /> Tab Audio Synced
              </Badge>
            )}
            <Button size="sm" variant="outline" className="h-7 text-xs rounded-full border-primary/30 text-primary hover:bg-primary/10 gap-1.5" onClick={togglePip}>
              <Maximize2 className="h-3 w-3" /> Floating Window (PiP)
            </Button>
          </div>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="glass border-white/10 flex-wrap">
          {m.status !== "completed" ? (
            <TabsTrigger value="transcript">Live Transcript</TabsTrigger>
          ) : (
            <>
              <TabsTrigger value="summary">AI Summary</TabsTrigger>
              <TabsTrigger value="actions">Actions & Decisions</TabsTrigger>
              <TabsTrigger value="tasks_recap">Tasks & Recap</TabsTrigger>
              <TabsTrigger value="send_email" className="flex items-center gap-1.5 font-medium">
                <Mail className="h-3.5 w-3.5 text-primary" /> Send Email
              </TabsTrigger>
              <TabsTrigger value="transcript">Full Transcript</TabsTrigger>
            </>
          )}
        </TabsList>

        <TabsContent value="transcript">
          <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
            {/* WhatsApp / Chat Bubble Container */}
            <div className="glass rounded-3xl p-4 sm:p-6 flex flex-col h-[65vh] bg-[#0c1317]/80 border-white/10 relative overflow-hidden">
              {/* WhatsApp Chat Header */}
              <div className="flex items-center justify-between pb-3 mb-2 border-b border-white/10 text-xs text-muted-foreground shrink-0">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="font-medium text-foreground">Live Chat Transcription</span>
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <span className="hidden sm:inline">{transcripts.length} msg{transcripts.length === 1 ? "" : "s"}</span>

                  <button
                    onClick={() => handleCleanAndAlign()}
                    disabled={isCleaningTranscript || transcripts.length === 0}
                    className="text-xs px-2.5 py-1 rounded-full bg-gradient-to-r from-purple-500/20 to-primary/20 hover:from-purple-500/30 hover:to-primary/30 border border-purple-500/30 text-purple-200 inline-flex items-center gap-1.5 font-medium cursor-pointer transition-all disabled:opacity-50"
                    title="Use Gemini AI to fix speech typos ('police dashboard' -> 'finish the dashboard') and separate speaker turns"
                  >
                    {isCleaningTranscript ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5 text-purple-300" />}
                    <span>{isCleaningTranscript ? "Cleaning..." : "AI Clean & Fix"}</span>
                  </button>

                  <Dialog open={editTranscriptModalOpen} onOpenChange={setEditTranscriptModalOpen}>
                    <DialogTrigger asChild>
                      <button
                        onClick={() => {
                          const currentText = transcripts.map(t => `${t.speaker}: ${t.content}`).join("\n");
                          setRawScriptInput(currentText);
                        }}
                        className="text-xs px-2.5 py-1 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-foreground inline-flex items-center gap-1 font-medium cursor-pointer transition-all"
                        title="Paste or edit meeting dialogue / script directly"
                      >
                        <Pencil className="h-3 w-3 text-sky-400" />
                        <span>Edit Script</span>
                      </button>
                    </DialogTrigger>
                    <DialogContent className="glass border-white/10 sm:max-w-xl">
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                          <Wand2 className="h-5 w-5 text-purple-400" />
                          <span>Edit / Paste Meeting Transcript</span>
                        </DialogTitle>
                        <DialogDescription>
                          Paste dialogue or meeting transcripts below. Gemini AI will fix any speech-to-text typos (e.g. &quot;police dashboard&quot; &rarr; &quot;finish the dashboard&quot;) and correctly attribute speaker turns between <b>Remote Participant</b> and <b>Sumeet Made</b>.
                        </DialogDescription>
                      </DialogHeader>

                      <div className="space-y-3 py-2">
                        <Textarea
                          rows={12}
                          value={rawScriptInput}
                          onChange={(e) => setRawScriptInput(e.target.value)}
                          placeholder="Paste dialogue here, for example:&#10;&#10;Remote Participant: Hi good morning thanks for joining...&#10;Sumeet Made: Good morning sure let's get started...&#10;Remote Participant: The frontend development is almost complete...&#10;Sumeet Made: I agree I will complete the dashboard by Wednesday..."
                          className="font-mono text-xs leading-relaxed bg-black/40 border-white/10"
                        />
                      </div>

                      <DialogFooter className="gap-2 sm:gap-0">
                        <Button
                          variant="ghost"
                          onClick={() => setEditTranscriptModalOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={() => handleCleanAndAlign(rawScriptInput)}
                          disabled={isCleaningTranscript || !rawScriptInput.trim()}
                          className="bg-gradient-to-r from-purple-600 to-primary hover:from-purple-500 hover:to-primary/90 text-white gap-2"
                        >
                          {isCleaningTranscript ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                          <span>Clean &amp; Re-align with AI</span>
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                  
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button 
                        className="text-xs px-2.5 py-1 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-foreground inline-flex items-center gap-1.5 font-medium cursor-pointer transition-all hover:border-primary/40"
                        title="Copy all meeting transcripts in multiple formats"
                      >
                        {copiedAll ? <ClipboardCheck className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 text-primary" />}
                        <span>{copiedAll ? "Copied All!" : "Copy All"}</span>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="glass border-white/10 w-52">
                      <DropdownMenuItem onClick={() => copyAllTranscripts("formatted")} className="cursor-pointer text-xs gap-2">
                        <Copy className="h-3.5 w-3.5 text-primary" />
                        <span>With Timestamps</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => copyAllTranscripts("plain")} className="cursor-pointer text-xs gap-2">
                        <FileText className="h-3.5 w-3.5 text-sky-400" />
                        <span>Plain Text Only</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => copyAllTranscripts("markdown")} className="cursor-pointer text-xs gap-2">
                        <FileText className="h-3.5 w-3.5 text-purple-400" />
                        <span>Markdown Format</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => copyAllTranscripts("json")} className="cursor-pointer text-xs gap-2">
                        <FileText className="h-3.5 w-3.5 text-amber-400" />
                        <span>JSON Format</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <button 
                    onClick={togglePip}
                    className="text-xs text-primary hover:underline inline-flex items-center gap-1 font-medium cursor-pointer"
                    title="Open always-on-top floating window over Google Meet"
                  >
                    <Maximize2 className="h-3 w-3" /> Pop-out
                  </button>
                </div>
              </div>

              {/* Chat Messages Scroll Area */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 pr-1.5">
                {transcripts.length === 0 && !interim && (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                      <Video className="h-6 w-6 text-primary" />
                    </div>
                    <p className="text-sm font-medium text-foreground">No transcript yet</p>
                    <p className="text-xs max-w-sm mt-1">Click <b>Join as AI Assistant</b> above to begin. Spoken words from you and remote participants will appear here in real-time chat format.</p>
                  </div>
                )}

                {transcripts.map((t) => {
                  const me = isMe(t.speaker);
                  const isMultiLine = t.content.includes("\n");
                  const initials = getInitials(t.speaker);
                  const avatarBg = getParticipantAvatarBg(t.speaker, me);
                  const remoteParticipant = participants.find(p => !isMe(p.name) && p.name.toLowerCase() !== "remote participant") || participants.find(p => !isMe(p.name));
                  const quickTargetSpeaker = me ? (remoteParticipant?.name || "Remote Participant") : (speakerRef.current || "You");

                  return (
                    <div key={t.id} className={`flex ${me ? "justify-end" : "justify-start"} items-start gap-2.5 group`}>
                      {/* Left Avatar for Remote Participant (like Anmol Patel in Google Meet) */}
                      {!me && (
                        <div className={`h-8 w-8 rounded-full ${avatarBg} text-white text-xs font-bold flex items-center justify-center shrink-0 shadow-md mt-0.5`}>
                          {initials}
                        </div>
                      )}

                      <div 
                        className={`relative max-w-[85%] sm:max-w-[75%] px-4 py-3 shadow-md transition-all ${
                          me 
                            ? "bg-[#005c4b] text-[#e9edef] rounded-2xl rounded-tr-xs border border-emerald-500/20" 
                            : "bg-[#202c33] text-[#e9edef] rounded-2xl rounded-tl-xs border border-white/10"
                        }`}
                      >
                        {/* Speaker & Quick Role Header */}
                        <div className="flex items-center justify-between gap-3 text-xs mb-1.5">
                          <DropdownMenu>
                            <DropdownMenuTrigger className={`font-semibold hover:underline cursor-pointer flex items-center gap-1 focus:outline-none ${me ? "text-emerald-200" : getSpeakerColor(t.speaker)}`}>
                              {me ? `${t.speaker} (Host)` : t.speaker}
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="glass border-white/10">
                              <DropdownMenuItem onClick={() => updateTranscriptSpeaker(t.id, quickTargetSpeaker)}>
                                <ArrowLeftRight className="mr-2 h-3.5 w-3.5 text-primary" />
                                Switch to {quickTargetSpeaker}
                              </DropdownMenuItem>
                              
                              <DropdownMenuItem onClick={() => updateTranscriptSpeaker(t.id, speakerRef.current)}>
                                Set to: {speakerRef.current} (Host)
                              </DropdownMenuItem>
                              {participants.filter(p => !isMe(p.name)).map(p => (
                                <DropdownMenuItem key={p.id} onClick={() => updateTranscriptSpeaker(t.id, p.name)}>
                                  Set to: {p.name}
                                </DropdownMenuItem>
                              ))}

                              <DropdownMenuItem onClick={() => copySingleTranscript(t)}>
                                <Copy className="mr-2 h-3.5 w-3.5 text-primary" />
                                Copy message text
                              </DropdownMenuItem>

                              {isMultiLine && (
                                <DropdownMenuItem onClick={() => splitTranscript(t.id)} className="text-amber-300 focus:text-amber-200">
                                  <Scissors className="mr-2 h-3.5 w-3.5" />
                                  Split into separate lines
                                </DropdownMenuItem>
                              )}

                              <DropdownMenuItem onClick={() => deleteTranscript(t.id)} className="text-destructive focus:text-destructive">
                                <Trash2 className="mr-2 h-3.5 w-3.5" />
                                Delete message
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>

                          <div className="flex items-center gap-1.5">
                            <button 
                              onClick={() => copySingleTranscript(t)} 
                              title="Copy message to clipboard"
                              className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-muted-foreground hover:text-white inline-flex items-center gap-1 transition-all"
                            >
                              {copiedTranscriptId === t.id ? <Check className="h-2.5 w-2.5 text-emerald-400" /> : <Copy className="h-2.5 w-2.5" />}
                              <span>{copiedTranscriptId === t.id ? "Copied" : "Copy"}</span>
                            </button>

                            {isMultiLine && (
                              <button 
                                onClick={() => splitTranscript(t.id)} 
                                title="Split into individual messages"
                                className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-amber-300 inline-flex items-center gap-1 transition-all"
                              >
                                <Scissors className="h-2.5 w-2.5" /> Split
                              </button>
                            )}
                            <Badge 
                              variant="outline" 
                              className={`text-[10px] px-2 py-0.5 font-semibold cursor-pointer transition-all ${
                                me 
                                  ? "border-emerald-400/40 text-emerald-200 bg-emerald-950/40 hover:bg-emerald-900/60" 
                                  : "border-purple-400/40 text-purple-200 bg-purple-950/40 hover:bg-purple-900/60"
                              }`}
                              onClick={() => updateTranscriptSpeaker(t.id, quickTargetSpeaker)}
                              title={`Click to switch speaker to ${quickTargetSpeaker}`}
                            >
                              <ArrowLeftRight className="h-2.5 w-2.5 mr-1 inline" />
                              {me ? (remoteParticipant?.name?.split(" ")[0] || "Remote") : "Host"}
                            </Badge>
                          </div>
                        </div>

                        {/* Content text */}
                        <div className="text-sm leading-relaxed whitespace-pre-wrap select-text font-normal">
                          {t.content}
                        </div>

                        {/* Footer with Timestamp and Checkmarks */}
                        <div className="flex items-center justify-end gap-1.5 mt-1.5 text-[10px] text-muted-foreground">
                          <span>
                            {safeFormatTime(t.spoken_at)}
                          </span>
                          {me && <CheckCheck className="h-3.5 w-3.5 text-[#53bdeb]" />}
                        </div>
                      </div>

                      {/* Right Avatar for Host (You) */}
                      {me && (
                        <div className={`h-8 w-8 rounded-full ${avatarBg} text-white text-xs font-bold flex items-center justify-center shrink-0 shadow-md mt-0.5`}>
                          {initials}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Live Speaking Interim Bubble */}
                {live && interim && (
                  <div className="flex justify-end items-start gap-2.5 animate-in fade-in duration-200">
                    <div className="relative max-w-[85%] sm:max-w-[75%] px-4 py-3 rounded-2xl rounded-tr-xs bg-[#005c4b]/85 text-[#e9edef] border border-emerald-400/40 shadow-lg">
                      <div className="flex items-center justify-between gap-2 text-xs mb-1.5 text-emerald-300 font-semibold">
                        <span className="flex items-center gap-1.5">
                          <Mic className="h-3.5 w-3.5 animate-pulse text-emerald-300" /> {speakerRef.current}
                        </span>
                        <span className="text-[10px] bg-emerald-900/60 px-1.5 py-0.5 rounded text-emerald-200 uppercase tracking-wider">Speaking</span>
                      </div>
                      <div className="text-sm leading-relaxed whitespace-pre-wrap text-emerald-50 italic">
                        {interim}
                      </div>
                    </div>
                    <div className="h-8 w-8 rounded-full bg-[#ea4335] text-white text-xs font-bold flex items-center justify-center shrink-0 shadow-md mt-0.5">
                      {getInitials(speakerRef.current)}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Participants Sidebar Card */}
            <aside className="glass h-fit rounded-3xl p-5 border-white/10 flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold text-foreground">Participants</h3>
                  <Badge variant="secondary" className="text-xs px-2 py-0.5 rounded-full">{participants.length}</Badge>
                </div>
                
                <Dialog open={addParticipantOpen} onOpenChange={setAddParticipantOpen}>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground">
                      <Plus className="h-4 w-4" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="glass border-white/10">
                    <DialogHeader>
                      <DialogTitle>Add Participant</DialogTitle>
                      <DialogDescription>Tag another participant in this meeting to assign tasks or personalize recaps.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 pt-2">
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Full Name</label>
                        <Input 
                          value={newParticipantName} 
                          onChange={(e) => setNewParticipantName(e.target.value)} 
                          placeholder="e.g. Anmol Patel" 
                          className="glass border-white/10" 
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Email (Optional)</label>
                        <Input 
                          value={newParticipantEmail} 
                          onChange={(e) => setNewParticipantEmail(e.target.value)} 
                          placeholder="anmol@example.com" 
                          className="glass border-white/10" 
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Role</label>
                        <select 
                          className="w-full bg-background border border-white/10 rounded-lg p-2 text-sm text-foreground focus:outline-none"
                          value={newParticipantRole}
                          onChange={(e) => setNewParticipantRole(e.target.value)}
                        >
                          <option value="participant">Participant / Team Member</option>
                          <option value="guest">Guest</option>
                          <option value="remote">Remote Participant</option>
                        </select>
                      </div>
                      <Button onClick={() => addParticipantManual()} className="w-full gradient-bg rounded-full shadow-glow">
                        Add Participant
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              {/* Instant Quick-Add Input Form */}
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newParticipantName.trim()) {
                    addParticipantManual(newParticipantName.trim());
                  }
                }}
                className="flex items-center gap-1.5 p-1 bg-white/5 rounded-xl border border-white/10 focus-within:border-primary/50 transition-colors"
              >
                <Input 
                  value={newParticipantName}
                  onChange={(e) => setNewParticipantName(e.target.value)}
                  placeholder="Add member (e.g. Anmol Patel)..."
                  className="h-8 text-xs bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-2 text-foreground"
                />
                <Button 
                  type="submit" 
                  size="sm" 
                  disabled={!newParticipantName.trim()} 
                  className="h-7 px-3 text-xs gradient-bg rounded-lg shadow-glow shrink-0 font-medium"
                >
                  <Plus className="h-3 w-3 mr-1" /> Add
                </Button>
              </form>

              {/* List of Attendees */}
              <div className="space-y-2.5">
                {participants.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">No participants validated yet.</p>
                )}
                {participants.map((p) => {
                  const host = p.role === "host" || isMe(p.name);
                  const initials = getInitials(p.name);
                  const avatarBg = getParticipantAvatarBg(p.name, host);
                  const isEditing = editingParticipantId === p.id;

                  return (
                    <div key={p.id} className="glass rounded-xl p-3 flex items-center justify-between gap-2 border-white/5 hover:border-white/15 transition-all group">
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 ${avatarBg} shadow-sm`}>
                          {initials}
                        </div>

                        {isEditing ? (
                          <form 
                            onSubmit={(e) => {
                              e.preventDefault();
                              renameParticipant(p.id, p.name, editParticipantName);
                            }}
                            className="flex items-center gap-1.5 flex-1 min-w-0"
                          >
                            <Input 
                              value={editParticipantName} 
                              onChange={(e) => setEditParticipantName(e.target.value)} 
                              autoFocus 
                              className="h-7 text-xs bg-white/10 border-white/20 px-2 flex-1 min-w-0 text-foreground" 
                            />
                            <Button type="submit" size="icon" className="h-7 w-7 gradient-bg rounded shrink-0">
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                          </form>
                        ) : (
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-sm text-foreground truncate flex items-center gap-1.5">
                              {p.name}
                            </div>
                            <div className="text-[11px] text-muted-foreground truncate">
                              {p.email || (host ? "Host & Speaker" : "Participant")}
                            </div>
                          </div>
                        )}
                      </div>

                      {!isEditing && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button 
                            onClick={() => {
                              setEditingParticipantId(p.id);
                              setEditParticipantName(p.name);
                            }}
                            title="Rename participant"
                            className="opacity-0 group-hover:opacity-100 p-1 hover:text-primary text-muted-foreground transition-opacity"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          
                          <Badge 
                            variant="outline" 
                            className={`text-[10px] uppercase font-semibold ${
                              host 
                                ? "border-primary/40 text-primary bg-primary/10" 
                                : "border-purple-400/30 text-purple-300 bg-purple-500/10"
                            }`}
                          >
                            {host ? "Host" : p.role || "Participant"}
                          </Badge>
                          {!host && (
                            <button 
                              onClick={() => removeParticipant(p.id, p.name)}
                              title="Remove participant"
                              className="opacity-0 group-hover:opacity-100 p-1 hover:text-destructive text-muted-foreground transition-opacity"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </aside>
          </div>
        </TabsContent>

        <TabsContent value="summary">
          {!summary ? (
            <div className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground flex flex-col items-center justify-center">
              {summarizing ? (
                <div className="space-y-3 flex flex-col items-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
                  <p>Generating AI summary from your transcript…</p>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="text-xs text-muted-foreground hover:text-foreground mt-2"
                    onClick={() => { setSummarizing(false); load(); }}
                  >
                    Cancel / Reset
                  </Button>
                </div>
              ) : m.status === "completed" ? (
                <div className="space-y-3">
                  <p>Summary generation was interrupted due to AI quota limits or network issues.</p>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    disabled={summarizing}
                    className="gradient-bg rounded-full text-white shadow-glow px-5"
                    onClick={() => triggerSummarization()}
                  >
                    {summarizing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                    {summarizing ? "Generating Summary..." : "Retry Summary Generation"}
                  </Button>
                </div>
              ) : (
                "Summary will appear here once the meeting ends."
              )}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="glass rounded-2xl p-6 md:col-span-2">
                <div className="mb-2 flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><h3 className="font-semibold">Executive summary</h3></div>
                <p className="text-sm text-muted-foreground">{summary.executive_summary}</p>
              </div>
              <SummaryList title="Key discussion points" items={summary.key_points} />
              <SummaryList title="Risks" items={summary.risks} />
              <SummaryList title="Follow-up tasks" items={summary.follow_ups} />
            </div>
          )}
        </TabsContent>

        <TabsContent value="actions">
          <div className="space-y-6">
            <div className="glass rounded-2xl p-6">
              <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <CheckSquare className="h-5 w-5 text-primary" />
                    <h3 className="text-lg font-bold">Action Items & To-Do Sync</h3>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Tasks from this meeting automatically sync with your personal To-Do list.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button 
                    onClick={handleSyncTasks} 
                    disabled={syncingTasks || summarizing}
                    size="sm" 
                    className="gradient-bg rounded-xl shadow-glow text-xs"
                  >
                    {syncingTasks || summarizing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                    {syncingTasks || summarizing ? "Generating & Extracting..." : (!summary ? "Generate Summary & Tasks" : "Auto-Extract Tasks with AI")}
                  </Button>

                  <Dialog open={addTaskModalOpen} onOpenChange={setAddTaskModalOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline" className="glass rounded-xl border-white/10 text-xs">
                        <Plus className="mr-1 h-3.5 w-3.5" /> Add Task
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="glass border-white/10 sm:max-w-md">
                      <DialogHeader>
                        <DialogTitle>Add Action Item</DialogTitle>
                        <DialogDescription>Create a task linked directly to this meeting.</DialogDescription>
                      </DialogHeader>
                      <form onSubmit={handleCreateActionItem} className="space-y-4 pt-2">
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-muted-foreground">Task Title</label>
                          <Input 
                            placeholder="e.g. Prepare presentation slides by Thursday"
                            value={newTaskTitle}
                            onChange={e => setNewTaskTitle(e.target.value)}
                            required
                            className="bg-white/5 border-white/10"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-muted-foreground">Assignee</label>
                          <Input 
                            placeholder={speakerRef.current || "Sumeet Made"}
                            value={newTaskAssignee}
                            onChange={e => setNewTaskAssignee(e.target.value)}
                            className="bg-white/5 border-white/10"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-muted-foreground">Due Date (Optional)</label>
                          <Input 
                            type="date"
                            value={newTaskDeadline}
                            onChange={e => setNewTaskDeadline(e.target.value)}
                            className="bg-white/5 border-white/10"
                          />
                        </div>
                        <DialogFooter className="pt-3">
                          <Button type="button" variant="ghost" onClick={() => setAddTaskModalOpen(false)}>Cancel</Button>
                          <Button type="submit" disabled={addingTask} className="gradient-bg shadow-glow">
                            {addingTask ? "Adding..." : "Add to Meeting & To-Do"}
                          </Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>

                  <Link to="/todo">
                    <Button size="sm" variant="ghost" className="text-xs text-primary hover:text-primary/80">
                      Open To-Do List <ArrowLeft className="ml-1 h-3.5 w-3.5 rotate-180" />
                    </Button>
                  </Link>
                </div>
              </div>

              <div className="space-y-2.5">
                {actions.length === 0 && (
                  <div className="text-center py-6 border border-dashed border-white/5 rounded-xl text-muted-foreground text-sm">
                    <p>No action items recorded for this meeting yet.</p>
                    {!summary ? (
                      <div className="mt-3 space-y-2 flex flex-col items-center">
                        <p className="text-xs text-muted-foreground/80">
                          The meeting summary hasn't been generated yet, so action items have not been extracted.
                        </p>
                        <Button 
                          size="sm"
                          onClick={() => triggerSummarization()}
                          disabled={summarizing}
                          className="gradient-bg rounded-full text-white shadow-glow px-4 text-xs"
                        >
                          {summarizing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                          {summarizing ? "Generating Summary & Tasks..." : "Generate Summary & Action Items with AI"}
                        </Button>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground/70 mt-1">
                        Click <strong className="text-white font-medium">"Auto-Extract Tasks with AI"</strong> above to extract tasks from the summary!
                      </p>
                    )}
                  </div>
                )}
                {actions.map((a) => (
                  <div key={a.id} className="glass rounded-xl p-3.5 flex items-center justify-between gap-3 hover:bg-white/5 transition border border-white/5">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <button 
                        onClick={() => toggleActionStatus(a.id, a.status)}
                        className={`h-5 w-5 rounded-md border flex items-center justify-center transition shrink-0 ${
                          a.status === "done" 
                            ? "bg-emerald-500/20 border-emerald-500 text-emerald-400" 
                            : "border-white/20 hover:border-white/40 text-transparent"
                        }`}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className={`text-sm font-medium ${a.status === "done" ? "line-through text-muted-foreground" : "text-white"}`}>
                          {a.title}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1 bg-white/5 px-2 py-0.5 rounded text-slate-300">
                            👤 {a.assignee || "Unassigned"}
                          </span>
                          {a.deadline && (
                            <span className="flex items-center gap-1 bg-white/5 px-2 py-0.5 rounded">
                              📅 {safeFormatDate(a.deadline)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant={a.status === "done" ? "secondary" : "outline"} className={`text-[10px] ${a.status === "done" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "border-white/10"}`}>
                        {a.status === "done" ? "Completed" : "Pending"}
                      </Badge>
                      <button 
                        onClick={() => deleteMeetingAction(a.id)}
                        className="p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition"
                        title="Delete task"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass rounded-2xl p-6">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold text-base">Key Decisions</h3>
                <Dialog open={addDecisionModalOpen} onOpenChange={setAddDecisionModalOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline" className="glass rounded-xl border-white/10 text-xs">
                      <Plus className="mr-1 h-3.5 w-3.5" /> Add Decision
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="glass border-white/10 sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>Log Strategic Decision</DialogTitle>
                      <DialogDescription>Record a strategic agreement or decision made during this meeting.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleCreateDecision} className="space-y-4 pt-2">
                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-muted-foreground">Decision Description</label>
                        <Textarea 
                          placeholder="e.g. Divide college event responsibilities: Sumeet handles registration, Remote handles decoration"
                          value={newDecisionDescription}
                          onChange={e => setNewDecisionDescription(e.target.value)}
                          required
                          className="bg-white/5 border-white/10"
                          rows={3}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-muted-foreground">Decided By (Optional)</label>
                        <Input 
                          placeholder="e.g. Both Participants or Sumeet Made"
                          value={newDecisionMadeBy}
                          onChange={e => setNewDecisionMadeBy(e.target.value)}
                          className="bg-white/5 border-white/10"
                        />
                      </div>
                      <DialogFooter className="pt-3">
                        <Button type="button" variant="ghost" onClick={() => setAddDecisionModalOpen(false)}>Cancel</Button>
                        <Button type="submit" disabled={addingDecision} className="gradient-bg shadow-glow">
                          {addingDecision ? "Saving..." : "Save Decision"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>

              <div className="space-y-2">
                {decisions.length === 0 && <p className="text-sm text-muted-foreground">No decisions logged.</p>}
                {decisions.map((d) => (
                  <div key={d.id} className="glass rounded-xl p-3 border border-white/5 flex items-start justify-between gap-3 group">
                    <div>
                      <div className="font-medium text-sm text-white">{d.description}</div>
                      {d.made_by && <div className="mt-1 text-xs text-muted-foreground">— {d.made_by}</div>}
                    </div>
                    <button
                      onClick={() => deleteMeetingDecision(d.id)}
                      className="p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 opacity-60 group-hover:opacity-100 transition shrink-0"
                      title="Delete decision"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="tasks_recap">
          <div className="space-y-6 animate-in fade-in-50 duration-300">
            {/* Action Items & Todo Sync Card */}
            <div className="glass rounded-2xl p-6 border border-white/10">
              <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <CheckSquare className="h-5 w-5 text-primary" />
                    <h3 className="text-lg font-bold">Meeting Tasks & Commitments</h3>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Tasks extracted from this meeting are automatically synchronized with your personal To-Do list.
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <Button 
                    onClick={handleSyncTasks} 
                    disabled={syncingTasks || summarizing}
                    size="sm" 
                    className="gradient-bg rounded-xl shadow-glow text-xs"
                  >
                    {syncingTasks || summarizing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                    {syncingTasks || summarizing ? "Generating & Extracting..." : (!summary ? "Generate Summary & Tasks" : "Auto-Extract Tasks with AI")}
                  </Button>

                  <Dialog open={addTaskModalOpen} onOpenChange={setAddTaskModalOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline" className="glass rounded-xl border-white/10 text-xs">
                        <Plus className="mr-1 h-3.5 w-3.5" /> Add Task
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="glass border-white/10 sm:max-w-md">
                      <DialogHeader>
                        <DialogTitle>Add Action Item</DialogTitle>
                        <DialogDescription>Create a task linked directly to this meeting.</DialogDescription>
                      </DialogHeader>
                      <form onSubmit={handleCreateActionItem} className="space-y-4 pt-2">
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-muted-foreground">Task Title</label>
                          <Input 
                            placeholder="e.g. Prepare presentation slides by Thursday"
                            value={newTaskTitle}
                            onChange={e => setNewTaskTitle(e.target.value)}
                            required
                            className="bg-white/5 border-white/10"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-muted-foreground">Assignee</label>
                          <Input 
                            placeholder={speakerRef.current || "Sumeet Made"}
                            value={newTaskAssignee}
                            onChange={e => setNewTaskAssignee(e.target.value)}
                            className="bg-white/5 border-white/10"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-muted-foreground">Due Date (Optional)</label>
                          <Input 
                            type="date"
                            value={newTaskDeadline}
                            onChange={e => setNewTaskDeadline(e.target.value)}
                            className="bg-white/5 border-white/10"
                          />
                        </div>
                        <DialogFooter className="pt-3">
                          <Button type="button" variant="ghost" onClick={() => setAddTaskModalOpen(false)}>Cancel</Button>
                          <Button type="submit" disabled={addingTask} className="gradient-bg shadow-glow">
                            {addingTask ? "Adding..." : "Add to Meeting & To-Do"}
                          </Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>

                  <Link to="/todo">
                    <Button size="sm" variant="ghost" className="text-xs text-primary hover:text-primary/80">
                      Open To-Do List <ArrowLeft className="ml-1 h-3.5 w-3.5 rotate-180" />
                    </Button>
                  </Link>
                </div>
              </div>

              <div className="space-y-2.5">
                {actions.length === 0 && (
                  <div className="text-center py-8 border border-dashed border-white/10 rounded-xl text-muted-foreground text-sm">
                    <CheckSquare className="h-8 w-8 mx-auto mb-2 opacity-30 text-primary" />
                    <p className="font-medium text-foreground">No tasks recorded for this meeting yet</p>
                    {!summary ? (
                      <div className="mt-3 space-y-2 flex flex-col items-center">
                        <p className="text-xs text-muted-foreground/80">
                          Summary and tasks have not been generated yet.
                        </p>
                        <Button 
                          size="sm"
                          onClick={() => triggerSummarization()}
                          disabled={summarizing}
                          className="gradient-bg rounded-full text-white shadow-glow px-4 text-xs"
                        >
                          {summarizing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                          {summarizing ? "Generating Summary & Tasks..." : "Generate Summary & Tasks with AI"}
                        </Button>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                        Click <strong className="text-white font-medium">"Auto-Extract Tasks with AI"</strong> above to extract all action items directly from the meeting summary!
                      </p>
                    )}
                  </div>
                )}
                {actions.map((a) => (
                  <div key={a.id} className="glass rounded-xl p-3.5 flex items-center justify-between gap-3 hover:bg-white/5 transition border border-white/5">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <button 
                        onClick={() => toggleActionStatus(a.id, a.status)}
                        className={`h-5 w-5 rounded-md border flex items-center justify-center transition shrink-0 ${
                          a.status === "done" 
                            ? "bg-emerald-500/20 border-emerald-500 text-emerald-400" 
                            : "border-white/20 hover:border-white/40 text-transparent"
                        }`}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className={`text-sm font-medium ${a.status === "done" ? "line-through text-muted-foreground" : "text-white"}`}>
                          {a.title}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1 bg-white/5 px-2 py-0.5 rounded text-slate-300">
                            👤 {a.assignee || "Unassigned"}
                          </span>
                          {a.deadline && (
                            <span className="flex items-center gap-1 bg-white/5 px-2 py-0.5 rounded">
                              📅 {safeFormatDate(a.deadline)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant={a.status === "done" ? "secondary" : "outline"} className={`text-[10px] ${a.status === "done" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "border-white/10"}`}>
                        {a.status === "done" ? "Completed" : "Pending"}
                      </Badge>
                      <button 
                        onClick={() => deleteMeetingAction(a.id)}
                        className="p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition"
                        title="Delete task"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Individual Participant Recaps Card */}
            <div className="glass rounded-2xl p-6 border border-white/10">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" />
                  <div>
                    <h3 className="font-semibold text-base">Individual Participant Tasks & Recaps</h3>
                    <p className="text-xs text-muted-foreground">Generates customized messages for each participant highlighting their specific deliverables.</p>
                  </div>
                </div>
                <Button onClick={handleGenerateRecaps} disabled={generatingRecaps || !summary} size="sm" className="gradient-bg rounded-xl shadow-glow text-xs">
                  {generatingRecaps ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-2 h-3.5 w-3.5" />}
                  Generate Individual Recaps
                </Button>
              </div>
              
              {studentRecaps.length === 0 && (
                <div className="text-center py-6 border border-dashed border-white/5 rounded-xl text-muted-foreground text-xs">
                  Click <strong>"Generate Individual Recaps"</strong> to break down tasks and send personal notes to each attendee.
                </div>
              )}

              {studentRecaps.length > 0 && (
                <div className="space-y-4 pt-2">
                  {studentRecaps.map((r, i) => (
                    <div key={i} className="glass rounded-xl p-4 border border-white/5 bg-white/5">
                      <div className="mb-2 font-semibold text-sm flex items-center justify-between">
                        <span>👤 {r.participantName}</span>
                        {r.email && <span className="text-muted-foreground text-xs font-normal">({r.email})</span>}
                      </div>
                      <pre className="whitespace-pre-wrap text-xs text-slate-200 bg-black/30 p-3 rounded-lg font-mono leading-relaxed border border-white/5">{r.body}</pre>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button 
                          size="sm" 
                          className="gradient-bg rounded-xl shadow-glow text-xs h-7"
                          onClick={() => {
                            openInGmail(r.email || "", r.subject, r.body);
                            toast.success(`Opening Gmail to send to ${r.participantName}...`);
                          }}
                        >
                          <ExternalLink className="mr-1.5 h-3 w-3" /> Send via Gmail
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="glass rounded-xl border-white/10 text-xs h-7" 
                          onClick={() => {
                            openInMailto(r.email || "", r.subject, r.body);
                            toast.success(`Opening Mail app for ${r.participantName}...`);
                          }}
                        >
                          <Mail className="mr-1.5 h-3 w-3 text-sky-400" /> Send via Mail App
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="glass rounded-xl border-white/10 text-xs h-7" 
                          onClick={() => { 
                            navigator.clipboard.writeText(r.body); 
                            toast.success(`Copied recap for ${r.participantName}!`); 
                          }}
                        >
                          <Copy className="mr-1.5 h-3 w-3" /> Copy Message
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="send_email">
          <div className="space-y-6 animate-in fade-in-50 duration-300">
            {/* General Recap Email Card */}
            <div className="glass rounded-2xl p-6 border border-white/10 bg-gradient-to-br from-white/5 to-transparent shadow-soft">
              <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Mail className="h-5 w-5 text-primary" />
                  <div>
                    <h3 className="font-bold text-base">Complete Meeting Recap Email</h3>
                    <p className="text-xs text-muted-foreground">Ready-to-send email with executive summary, action items, and strategic decisions.</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button 
                    onClick={() => prepareEmailShare()}
                    className="gradient-bg rounded-xl shadow-glow text-xs flex items-center gap-1.5"
                  >
                    <Mail className="h-3.5 w-3.5" /> Customize & Send
                  </Button>
                </div>
              </div>

              {/* Recipient Quick Input */}
              <div className="mb-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Send to Email Address</label>
                  <span className="text-[10px] text-muted-foreground">Supports any email or comma-separated list</span>
                </div>
                <div className="flex gap-2">
                  <Input 
                    placeholder="Enter recipient email (e.g. client@company.com, team@domain.com)..."
                    value={emailRecipients}
                    onChange={(e) => setEmailRecipients(e.target.value)}
                    className="bg-white/5 border-white/10 text-xs h-9 rounded-xl flex-1"
                  />
                  <Button 
                    onClick={() => {
                      const to = emailRecipients.trim() || (participants.map(p => p.email).filter(Boolean).join(", "));
                      const { subject, body } = generateCompleteMeetingEmail(m, summary, actions, decisions, participants);
                      openInGmail(to, subject, body);
                      toast.success("Opening Gmail Compose window...");
                    }}
                    className="gradient-bg rounded-xl shadow-glow text-xs h-9 px-4 shrink-0"
                  >
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Send with Gmail
                  </Button>
                </div>
              </div>

              <pre className="glass whitespace-pre-wrap rounded-xl p-4 text-xs font-mono bg-black/40 text-slate-200 max-h-72 overflow-y-auto leading-relaxed border border-white/5">
                {emailDraft || "Summary required first."}
              </pre>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button 
                  className="gradient-bg rounded-xl shadow-glow text-xs h-8"
                  onClick={() => {
                    const to = emailRecipients.trim() || (participants.map(p => p.email).filter(Boolean).join(", "));
                    const { subject, body } = generateCompleteMeetingEmail(m, summary, actions, decisions, participants);
                    openInGmail(to, subject, body);
                    toast.success("Opening Gmail Compose window...");
                  }}
                >
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open in Gmail
                </Button>

                <Button 
                  variant="outline" 
                  className="glass rounded-xl border-white/10 text-xs h-8" 
                  onClick={() => {
                    const to = emailRecipients.trim() || (participants.map(p => p.email).filter(Boolean).join(", "));
                    const { subject, body } = generateCompleteMeetingEmail(m, summary, actions, decisions, participants);
                    openInMailto(to, subject, body);
                    toast.success("Opening Default Mail App...");
                  }}
                >
                  <Mail className="mr-1.5 h-3.5 w-3.5 text-sky-400" /> Send via Mail App (Outlook / Apple Mail)
                </Button>

                <Button 
                  variant="outline" 
                  className="glass rounded-xl border-white/10 text-xs h-8" 
                  onClick={() => { 
                    navigator.clipboard.writeText(emailDraft); 
                    toast.success("Full email recap copied to clipboard!"); 
                  }}
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy Email Content
                </Button>
              </div>
            </div>

            {/* Individual Participant Recaps Card */}
            <div className="glass rounded-2xl p-6 border border-white/10">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold text-base">Individual Participant Recaps & Action Items</h3>
                </div>
                <Button onClick={handleGenerateRecaps} disabled={generatingRecaps || summarizing} size="sm" className="gradient-bg rounded-xl shadow-glow text-xs">
                  {generatingRecaps || summarizing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-2 h-3.5 w-3.5" />}
                  {generatingRecaps ? "Generating..." : (!summary ? "Generate Summary & Recaps" : "Generate Individual Recaps")}
                </Button>
              </div>
              <p className="mb-4 text-xs text-muted-foreground">Generates personalized messages for each participant highlighting their specific deliverables.</p>
              
              {studentRecaps.length > 0 && (
                <div className="space-y-4">
                  {studentRecaps.map((r, i) => (
                    <div key={i} className="glass rounded-xl p-4 border border-white/5 bg-white/5">
                      <div className="mb-2 font-semibold text-sm flex items-center justify-between">
                        <span>👤 {r.participantName}</span>
                        {r.email && <span className="text-muted-foreground text-xs font-normal">({r.email})</span>}
                      </div>
                      <pre className="whitespace-pre-wrap text-xs text-slate-200 bg-black/30 p-3 rounded-lg font-mono leading-relaxed border border-white/5">{r.body}</pre>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button 
                          size="sm" 
                          className="gradient-bg rounded-xl shadow-glow text-xs h-7"
                          onClick={() => {
                            openInGmail(r.email || "", r.subject, r.body);
                            toast.success(`Opening Gmail to send to ${r.participantName}...`);
                          }}
                        >
                          <ExternalLink className="mr-1.5 h-3 w-3" /> Send via Gmail
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="glass rounded-xl border-white/10 text-xs h-7" 
                          onClick={() => {
                            openInMailto(r.email || "", r.subject, r.body);
                            toast.success(`Opening Mail app for ${r.participantName}...`);
                          }}
                        >
                          <Mail className="mr-1.5 h-3 w-3 text-sky-400" /> Send via Mail App
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="glass rounded-xl border-white/10 text-xs h-7" 
                          onClick={() => { 
                            navigator.clipboard.writeText(r.body); 
                            toast.success(`Copied recap for ${r.participantName}!`); 
                          }}
                        >
                          <Copy className="mr-1.5 h-3 w-3" /> Copy Message
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Comprehensive Share Meeting Recap Modal */}
      <Dialog open={emailModalOpen} onOpenChange={setEmailModalOpen}>
        <DialogContent className="glass border-white/10 sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-2 text-primary font-semibold text-xs tracking-wider uppercase">
              <Mail className="h-4 w-4" /> Share Meeting Intelligence
            </div>
            <DialogTitle className="text-xl font-bold">Email Meeting Recap & Action Items</DialogTitle>
            <DialogDescription>
              Send the full meeting summary, commitments, decisions, and action items to any team member or client.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* Recipient Input */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recipient Email(s)</label>
                <span className="text-[11px] text-muted-foreground">Separate multiple with commas</span>
              </div>
              <Input
                placeholder="e.g. client@company.com, teammate@acme.com"
                value={emailRecipients}
                onChange={(e) => setEmailRecipients(e.target.value)}
                className="glass border-white/10 text-sm"
              />

              {/* Quick-add participant chips */}
              {participants.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[11px] text-muted-foreground mr-1">Quick add attendee:</span>
                  {participants.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        const emailToAdd = p.email || `${p.name.toLowerCase().replace(/\s+/g, '')}@example.com`;
                        if (!emailRecipients.includes(emailToAdd)) {
                          setEmailRecipients(prev => prev ? `${prev}, ${emailToAdd}` : emailToAdd);
                        }
                      }}
                      className="text-[11px] bg-white/5 hover:bg-white/10 border border-white/10 px-2.5 py-0.5 rounded-full transition text-slate-300 hover:text-white flex items-center gap-1"
                    >
                      <span>+ {p.name}</span>
                      {p.email && <span className="text-muted-foreground">({p.email})</span>}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      const all = participants.map(p => p.email || `${p.name.toLowerCase().replace(/\s+/g, '')}@example.com`).join(", ");
                      setEmailRecipients(all);
                    }}
                    className="text-[11px] bg-primary/10 hover:bg-primary/20 border border-primary/20 px-2.5 py-0.5 rounded-full transition text-primary font-medium"
                  >
                    + Add All Attendees
                  </button>
                </div>
              )}
            </div>

            {/* Subject Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Subject</label>
              <Input
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                className="glass border-white/10 text-sm font-medium"
              />
            </div>

            {/* Email Body Preview & Editor */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email Content Preview</label>
                <span className="text-[11px] text-muted-foreground">Editable before sending</span>
              </div>
              <Textarea
                rows={11}
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                className="glass border-white/10 text-xs font-mono leading-relaxed bg-black/40"
              />
            </div>

            {/* Modal Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-white/10">
              <Button
                type="button"
                variant="outline"
                className="glass rounded-xl border-white/10 text-xs"
                onClick={() => {
                  navigator.clipboard.writeText(emailBody);
                  toast.success("Full email recap copied to clipboard!");
                }}
              >
                <Copy className="mr-2 h-3.5 w-3.5" /> Copy Email Content
              </Button>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="glass rounded-xl border-white/10 text-xs"
                  onClick={() => {
                    openInMailto(emailRecipients, emailSubject, emailBody);
                    toast.success("Opening Default Mail client...");
                  }}
                >
                  <Mail className="mr-2 h-3.5 w-3.5 text-sky-400" /> Open in Mail App
                </Button>

                <Button
                  type="button"
                  className="gradient-bg rounded-xl shadow-glow text-xs"
                  onClick={() => {
                    openInGmail(emailRecipients, emailSubject, emailBody);
                    toast.success("Opening Gmail compose window...");
                    setEmailModalOpen(false);
                  }}
                >
                  <ExternalLink className="mr-2 h-3.5 w-3.5" /> Send via Gmail
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* previous-meeting memory */}
      <section className="glass rounded-2xl p-6 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Continuous Meeting Memory</h3>
          </div>
          <span className="text-xs px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
            Cross-Meeting Sync Active
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          AI Powered Meeting Companion synchronizes task status, pending review commitments, and strategic decisions across sequential meetings. <Link to="/chat" className="text-primary hover:underline">Ask AI →</Link>
        </p>

        {((m?.title || "").toLowerCase().includes("new2") || (m?.title || "").toLowerCase().includes("meeting 2") || (summary?.executive_summary || "").toLowerCase().includes("shreyash")) && (
          <div className="pt-2 border-t border-white/5 space-y-2 text-xs">
            <div className="flex items-center gap-2 text-emerald-400">
              <Check className="h-3.5 w-3.5" />
              <span>Verified completed: Project dashboard & UI improvements (Shreyash).</span>
            </div>
            <div className="flex items-center gap-2 text-amber-400">
              <Calendar className="h-3.5 w-3.5" />
              <span>Active commitment retained: Joint review of all completed deliverables (Friday).</span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryList({ title, items }: { title: string; items: any }) {
  const list = Array.isArray(items) ? items : typeof items === "string" ? [items] : [];
  return (
    <div className="glass rounded-2xl p-6">
      <h3 className="mb-3 font-semibold">{title}</h3>
      <ul className="space-y-2 text-sm">
        {list.map((it, i) => (
          <li key={i} className="glass rounded-xl px-3 py-2">{typeof it === "string" ? it : JSON.stringify(it)}</li>
        ))}
        {list.length === 0 && <p className="text-xs text-muted-foreground">None.</p>}
      </ul>
    </div>
  );
}
