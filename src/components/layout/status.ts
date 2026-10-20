export type KnownStatus = "live" | "upcoming" | "completed" | "pending" | "in_progress" | "done";

export const STATUS_CLASSES: Record<KnownStatus, string> = {
  live: "bg-destructive/15 text-destructive",
  upcoming: "bg-primary/15 text-primary",
  completed: "bg-muted text-muted-foreground",
  pending: "bg-muted text-muted-foreground",
  in_progress: "bg-info/15 text-info",
  done: "bg-success/15 text-success",
};

export const STATUS_LABELS: Record<KnownStatus, string> = {
  live: "Live",
  upcoming: "Upcoming",
  completed: "Completed",
  pending: "Pending",
  in_progress: "In progress",
  done: "Done",
};

export type MeetingStatus = "live" | "upcoming" | "completed";

export function normalizeMeetingStatus(status: string | null | undefined): MeetingStatus {
  if (status === "live" || status === "in_progress") return "live";
  if (status === "completed") return "completed";
  return "upcoming";
}

function isKnown(status: string): status is KnownStatus {
  return Object.prototype.hasOwnProperty.call(STATUS_CLASSES, status);
}

export function statusClasses(status: string | null | undefined): string {
  return status && isKnown(status) ? STATUS_CLASSES[status] : "bg-muted text-muted-foreground";
}

export function statusLabel(status: string | null | undefined): string {
  if (!status) return "Unknown";
  if (isKnown(status)) return STATUS_LABELS[status];
  return status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
