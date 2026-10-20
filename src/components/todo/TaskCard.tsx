import { CalendarDays, MoreVertical, Trash2, UserRound, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TASK_STATUSES, TASK_STATUS_LABEL, type TaskStatus } from "@/components/meeting/status";
import { formatDeadline } from "@/components/meeting/utils";
import type { TodoMeeting, TodoTask } from "@/hooks/use-todo-tasks";

export const TASK_DRAG_TYPE = "text/x-task-id";

export function TaskCard({
  task,
  meeting,
  onOpen,
  onMove,
  onDelete,
}: {
  task: TodoTask;
  meeting: TodoMeeting | undefined;
  onOpen: (task: TodoTask) => void;
  onMove: (taskId: string, status: TaskStatus) => void;
  onDelete: (taskId: string) => void;
}) {
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(TASK_DRAG_TYPE, task.id);
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="group relative rounded-2xl border border-border bg-surface-1 shadow-soft transition-colors hover:border-primary/40 focus-within:border-primary/40"
    >
      <button
        type="button"
        onClick={() => onOpen(task)}
        className="block w-full rounded-2xl p-4 pr-12 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Open task: ${task.title}`}
      >
        <span className="block break-words text-sm font-semibold leading-snug">{task.title}</span>
        <span className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <UserRound className="h-3.5 w-3.5" aria-hidden />
            <span className="max-w-[10rem] truncate">{task.assignee || "Unassigned"}</span>
          </span>
          <span className="inline-flex max-w-[12rem] items-center gap-1 truncate">
            <Video className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{meeting?.title || "Shared with you"}</span>
          </span>
          {task.deadline && (
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              {formatDeadline(task.deadline)}
            </span>
          )}
        </span>
      </button>
      <div className="absolute right-2 top-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={`Actions for task: ${task.title}`}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Move to…</DropdownMenuLabel>
            {TASK_STATUSES.filter((s) => s !== task.status).map((s) => (
              <DropdownMenuItem key={s} onSelect={() => onMove(task.id, s)}>
                {TASK_STATUS_LABEL[s]}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => onDelete(task.id)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete task
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
