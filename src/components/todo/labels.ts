import { STATUS_LABELS } from "@/components/layout/status";
import { TASK_STATUS_LABEL, type TaskStatus } from "@/components/meeting/status";
import type { TodoMeeting, TodoTask } from "@/hooks/use-todo-tasks";

export const TODO_STATUS_LABEL: Record<TaskStatus, string> = {
  ...TASK_STATUS_LABEL,
  done: STATUS_LABELS.done,
};

export function taskReferenceDate(task: TodoTask, meeting: TodoMeeting | undefined): string {
  return meeting?.scheduled_at || meeting?.created_at || task.created_at;
}
