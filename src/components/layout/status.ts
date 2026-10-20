/** Meeting statuses (`meetings.status`) and task statuses (`action_items.status`). */
export type KnownStatus = "live" | "upcoming" | "completed" | "pending" | "in_progress" | "done";

/** The single source of truth for status colours. Use these classes and nothing else. */
export const STATUS_CLASSES: Record<KnownStatus, string> = {
  live: "bg-destructive/15 text-destructive",
  upcoming: "bg-primary/15 text-primary",
  completed: "bg-muted text-muted-foreground",
  pending: "bg-muted text-muted-foreground",
  in_progress: "bg-info/15 text-info",
  done: "bg-success/15 text-success",
};

/** Human-readable labels for each status. */
export const STATUS_LABELS: Record<KnownStatus, string> = {
  live: "Live",
  upcoming: "Upcoming",
  completed: "Completed",
  pending: "Pending",
  in_progress: "In progress",
  done: "Done",
};

export type MeetingStatus = "live" | "upcoming" | "completed";

/**
 * Maps a stored `meetings.status` onto the three meeting statuses. Older rows
 * may still say "in_progress" for a running meeting, so that reads as live.
 */
export function normalizeMeetingStatus(status: string | null | undefined): MeetingStatus {
  if (status === "live" || status === "in_progress") return "live";
  if (status === "completed") return "completed";
  return "upcoming";
}

function isKnown(status: string): status is KnownStatus {
  return Object.prototype.hasOwnProperty.call(STATUS_CLASSES, status);
}

/** Returns the colour classes for a status; unknown values fall back to muted. */
export function statusClasses(status: string | null | undefined): string {
  return status && isKnown(status) ? STATUS_CLASSES[status] : "bg-muted text-muted-foreground";
}

/** Returns the display label for a status (unknown values are sentence-cased). */
export function statusLabel(status: string | null | undefined): string {
  if (!status) return "Unknown";
  if (isKnown(status)) return STATUS_LABELS[status];
  return status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
