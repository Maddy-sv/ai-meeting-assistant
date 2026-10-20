import { safeFormatDeadline } from "@/lib/continuous-memory";

export function formatDuration(seconds: number | null | undefined): string {
  const s = seconds ?? 0;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export const MEETING_PLATFORMS = [
  { value: "google_meet", label: "Google Meet" },
  { value: "teams", label: "Microsoft Teams" },
  { value: "manual", label: "Other / manual link" },
] as const;

export type MeetingPlatform = (typeof MEETING_PLATFORMS)[number]["value"];

export function platformLabel(platform: string | null | undefined): string {
  const known = MEETING_PLATFORMS.find((p) => p.value === platform);
  if (known) return known.label;
  return platform ? platform.replace(/_/g, " ") : "Unknown";
}

export function safeExternalUrl(link: string | null | undefined): string | null {
  if (!link) return null;
  try {
    const url = new URL(link);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function formatDeadlineFrom(
  deadline: string | null | undefined,
  referenceDate: string | null | undefined,
): string {
  if (!deadline) return "";
  return safeFormatDeadline(deadline, referenceDate || null);
}
