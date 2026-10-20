import { safeFormatDeadline } from "@/lib/continuous-memory";
import { normalizeTaskStatus } from "./status";
import type {
  ActionItem,
  CopyFormat,
  Decision,
  Meeting,
  Participant,
  Summary,
  Transcript,
} from "./types";

export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string" && msg) return msg;
  }
  return fallback;
}

export const NO_PERMISSION_MESSAGE = "You don't have permission to change this meeting.";

export function mutationError(
  res: { data: unknown[] | null; error: { message?: string } | null },
  fallback: string,
): string | null {
  if (res.error) return res.error.message || fallback;
  if (!res.data || res.data.length === 0) return NO_PERMISSION_MESSAGE;
  return null;
}

export function formatTime(val?: string | null): string {
  if (!val) return "";
  const d = new Date(val);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatDateTime(val?: string | null): string {
  if (!val) return "";
  const d = new Date(val);
  return isNaN(d.getTime()) ? "" : d.toLocaleString();
}

export function formatDeadline(val?: string | null): string {
  if (!val) return "";
  return safeFormatDeadline(val);
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

export function getInitials(name?: string | null): string {
  if (!name || !name.trim()) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const SPEAKER_TONES = [
  "bg-chart-1/20 text-chart-1",
  "bg-chart-2/20 text-chart-2",
  "bg-chart-3/20 text-chart-3",
  "bg-chart-4/20 text-chart-4",
  "bg-chart-5/20 text-chart-5",
];

export function speakerTone(name: string | null | undefined, isHost: boolean): string {
  if (isHost) return "bg-primary/20 text-primary";
  const str = (name || "").toLowerCase().trim();
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) | 0;
  return SPEAKER_TONES[Math.abs(hash) % SPEAKER_TONES.length];
}

export const REMOTE_PARTICIPANT_LABEL = "Remote Participant";

const GENERIC_SPEAKERS = new Set([
  "remote",
  "remote participant",
  "remote speaker",
  "unknown",
  "unknown speaker",
  "speaker",
  "participant",
]);

export function isGenericRemote(name?: string | null): boolean {
  return GENERIC_SPEAKERS.has((name ?? "").trim().toLowerCase());
}

export function firstName(name?: string | null): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

export function friendlyAiError(err: unknown, fallback: string): string {
  const msg = errorMessage(err, fallback);
  const lower = msg.toLowerCase();
  if (
    lower.includes("api key not valid") ||
    lower.includes("api_key_invalid") ||
    lower.includes("unauthenticated") ||
    lower.includes("invalid authentication credentials")
  ) {
    return "Invalid Gemini API key. Ask the administrator to set a valid GEMINI_API_KEY from Google AI Studio.";
  }
  if (
    lower.includes("429") ||
    lower.includes("resource_exhausted") ||
    lower.includes("rate-limit") ||
    lower.includes("rate_limit") ||
    lower.includes("please retry in")
  ) {
    return "AI rate limit reached. The request was retried automatically. Please wait a few seconds and click Retry.";
  }
  if (lower.includes("503") || lower.includes("overloaded") || lower.includes("high demand")) {
    return "The AI model is currently experiencing high demand. Please try again in a few moments.";
  }
  if (lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return "Could not reach the server. Check your connection and click Retry.";
  }
  return msg;
}

export function isSameName(a?: string | null, b?: string | null): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function formatTranscripts(
  transcripts: Transcript[],
  format: CopyFormat,
  meeting: Meeting | null,
): string {
  switch (format) {
    case "plain":
      return transcripts.map((t) => `${t.speaker}: ${t.content}`).join("\n");
    case "markdown":
      return (
        `# ${meeting?.title || "Meeting"} - Transcript\n` +
        `*Date: ${formatDateTime(meeting?.started_at || meeting?.created_at)}*\n\n` +
        transcripts
          .map((t) => `**${t.speaker}** \`[${formatTime(t.spoken_at)}]\`:\n> ${t.content}`)
          .join("\n\n")
      );
    case "json":
      return JSON.stringify(
        transcripts.map((t) => ({
          speaker: t.speaker,
          content: t.content,
          spoken_at: t.spoken_at,
          segment_index: t.segment_index,
        })),
        null,
        2,
      );
    default:
      return transcripts
        .map((t) => `[${formatTime(t.spoken_at)}] ${t.speaker}: ${t.content}`)
        .join("\n");
  }
}

export function downloadTranscript(meeting: Meeting | null, transcripts: Transcript[]): boolean {
  if (transcripts.length === 0) return false;
  downloadTextFile(
    `${meeting?.title || "meeting"}-transcript.txt`,
    formatTranscripts(transcripts, "formatted", meeting),
  );
  return true;
}

export function downloadTextFile(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const RULE = "----------------------------------------";

export function buildMeetingEmail(
  meeting: Meeting | null,
  summary: Summary | null,
  actions: ActionItem[],
  decisions: Decision[],
  participants: Participant[],
): { subject: string; body: string } {
  const title = meeting?.title || "Meeting";
  const dateStr = formatDateTime(meeting?.started_at || meeting?.scheduled_at || null);
  const subject = `Meeting recap: ${title}${dateStr ? ` (${dateStr})` : ""}`;

  let body = `Hi all,\n\nHere is the recap of "${title}"${dateStr ? ` (${dateStr})` : ""}.\n\n`;

  if (summary?.executive_summary) {
    body += `${RULE}\nSUMMARY\n${RULE}\n${summary.executive_summary}\n\n`;
  }
  if (actions.length > 0) {
    body += `${RULE}\nACTION ITEMS\n${RULE}\n`;
    actions.forEach((a, idx) => {
      const status = normalizeTaskStatus(a.status) === "done" ? "[done]" : "[open]";
      const assignee = a.assignee ? ` | Owner: ${a.assignee}` : "";
      const deadline = a.deadline ? ` | Due: ${formatDeadline(a.deadline)}` : "";
      body += `${idx + 1}. ${status} ${a.title}${assignee}${deadline}\n`;
    });
    body += `\n`;
  }
  if (decisions.length > 0) {
    body += `${RULE}\nDECISIONS\n${RULE}\n`;
    decisions.forEach((d, idx) => {
      body += `${idx + 1}. ${d.description}${d.made_by ? ` (${d.made_by})` : ""}\n`;
    });
    body += `\n`;
  }
  const keyPoints = toStringList(summary?.key_points);
  if (keyPoints.length > 0) {
    body += `${RULE}\nKEY POINTS\n${RULE}\n${keyPoints.map((k) => `- ${k}`).join("\n")}\n\n`;
  }
  if (participants.length > 0) {
    body += `${RULE}\nATTENDEES\n${RULE}\n`;
    body += participants.map((p) => `${p.name}${p.email ? ` <${p.email}>` : ""}`).join(", ");
    body += `\n\n`;
  }
  body += `Best regards`;
  return { subject, body };
}

export function participantEmails(participants: Participant[]): string[] {
  return participants.map((p) => (p.email || "").trim()).filter(Boolean);
}

export function openInGmail(to: string, subject: string, body: string) {
  const url = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

export function openInMailApp(to: string, subject: string, body: string) {
  const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = url;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
