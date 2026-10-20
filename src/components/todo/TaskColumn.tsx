import { useState } from "react";
import { TASK_STATUS_LABEL, taskStatusClass, type TaskStatus } from "@/components/meeting/status";
import type { TodoMeeting, TodoTask } from "@/hooks/use-todo-tasks";
import { TASK_DRAG_TYPE, TaskCard } from "./TaskCard";

export function TaskColumn({
  status,
  tasks,
  meetingsById,
  onOpen,
  onMove,
  onDelete,
}: {
  status: TaskStatus;
  tasks: TodoTask[];
  meetingsById: Map<string, TodoMeeting>;
  onOpen: (task: TodoTask) => void;
  onMove: (taskId: string, status: TaskStatus) => void;
  onDelete: (taskId: string) => void;
}) {
  const [isOver, setIsOver] = useState(false);
  const headingId = `column-${status}`;

  return (
    <section
      aria-labelledby={headingId}
      className={`flex min-h-[50vh] flex-col rounded-3xl border p-4 transition-colors sm:p-5 ${
        isOver ? "border-primary bg-primary/5" : "border-border bg-card"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setIsOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsOver(false);
        const id = e.dataTransfer.getData(TASK_DRAG_TYPE) || e.dataTransfer.getData("text/plain");
        if (id) onMove(id, status);
      }}
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 id={headingId} className="text-base font-semibold">
          {TASK_STATUS_LABEL[status]}
        </h2>
        <span
          className={`flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs font-semibold ${taskStatusClass(status)}`}
          aria-label={`${tasks.length} tasks`}
        >
          {tasks.length}
        </span>
      </div>
      {tasks.length === 0 ? (
        <div
          className={`flex flex-1 flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center text-xs ${
            isOver ? "border-primary/50 text-primary" : "border-border text-muted-foreground"
          }`}
        >
          <p>{isOver ? "Drop to move the task here" : "No tasks here"}</p>
          <p className="mt-1">Drag a card here or use its Move to… menu.</p>
        </div>
      ) : (
        <ul className="flex flex-1 flex-col gap-3">
          {tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              meeting={t.meeting_id ? meetingsById.get(t.meeting_id) : undefined}
              onOpen={onOpen}
              onMove={onMove}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
