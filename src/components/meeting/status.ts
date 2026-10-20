/** Single source of truth for meeting and task status colours (see the design brief). */

export type TaskStatus = "pending" | "in_progress" | "done";

export const TASK_STATUSES: TaskStatus[] = ["pending", "in_progress", "done"];

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "To do",
  in_progress: "In progress",
  done: "Done",
};

const TASK_STATUS_CLASS: Record<TaskStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  in_progress: "bg-info/15 text-info",
  done: "bg-success/15 text-success",
};

/** Maps legacy values ("completed") onto the three supported task statuses. */
export function normalizeTaskStatus(status: string | null | undefined): TaskStatus {
  if (status === "done" || status === "completed") return "done";
  if (status === "in_progress") return "in_progress";
  return "pending";
}

export function taskStatusClass(status: string | null | undefined): string {
  return TASK_STATUS_CLASS[normalizeTaskStatus(status)];
}

export function taskStatusLabel(status: string | null | undefined): string {
  return TASK_STATUS_LABEL[normalizeTaskStatus(status)];
}

type MeetingStatusKey = "live" | "upcoming" | "completed";

const MEETING_STATUS_CLASS: Record<MeetingStatusKey, string> = {
  live: "bg-destructive/15 text-destructive",
  upcoming: "bg-primary/15 text-primary",
  completed: "bg-muted text-muted-foreground",
};

const MEETING_STATUS_LABEL: Record<MeetingStatusKey, string> = {
  live: "Live",
  upcoming: "Upcoming",
  completed: "Completed",
};

function meetingStatusKey(status: string | null | undefined): MeetingStatusKey {
  if (status === "live" || status === "in_progress") return "live";
  if (status === "completed") return "completed";
  return "upcoming";
}

export function meetingStatusClass(status: string | null | undefined): string {
  return MEETING_STATUS_CLASS[meetingStatusKey(status)];
}

export function meetingStatusLabel(status: string | null | undefined): string {
  return MEETING_STATUS_LABEL[meetingStatusKey(status)];
}
