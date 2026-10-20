import { useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TASK_STATUSES, type TaskStatus } from "@/components/meeting/status";
import { TODO_STATUS_LABEL } from "./labels";
import type { TodoMeeting, TodoTask } from "@/hooks/use-todo-tasks";
import { TaskColumn } from "./TaskColumn";

export function KanbanBoard({
  tasks,
  meetingsById,
  onOpen,
  onMove,
  onDelete,
}: {
  tasks: TodoTask[];
  meetingsById: Map<string, TodoMeeting>;
  onOpen: (task: TodoTask) => void;
  onMove: (taskId: string, status: TaskStatus) => void;
  onDelete: (taskId: string) => void;
}) {
  const [mobileStatus, setMobileStatus] = useState<TaskStatus>("pending");
  const byStatus = (s: TaskStatus) => tasks.filter((t) => t.status === s);

  return (
    <div className="space-y-4">
      <ToggleGroup
        type="single"
        value={mobileStatus}
        onValueChange={(v) => v && setMobileStatus(v as TaskStatus)}
        className="grid grid-cols-3 rounded-full border border-border bg-card p-1 md:hidden"
        aria-label="Choose which column to show"
      >
        {TASK_STATUSES.map((s) => (
          <ToggleGroupItem
            key={s}
            value={s}
            className="rounded-full text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          >
            {TODO_STATUS_LABEL[s]} ({byStatus(s).length})
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <div className="grid gap-4 md:grid-cols-3 md:gap-6">
        {TASK_STATUSES.map((s) => (
          <div key={s} className={s === mobileStatus ? "block" : "hidden md:block"}>
            <TaskColumn
              status={s}
              tasks={byStatus(s)}
              meetingsById={meetingsById}
              onOpen={onOpen}
              onMove={onMove}
              onDelete={onDelete}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
