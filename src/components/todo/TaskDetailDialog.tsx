import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  CalendarDays,
  Loader2,
  Mail,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { TASK_STATUSES, taskStatusClass, type TaskStatus } from "@/components/meeting/status";
import { toStringList } from "@/components/meeting/utils";
import type { TodoMeeting, TodoTask } from "@/hooks/use-todo-tasks";
import { formatDeadlineFrom } from "@/lib/format";
import { TODO_STATUS_LABEL, taskReferenceDate } from "./labels";

type MeetingSummary = { executive_summary: string | null; key_points: unknown };

function MeetingContext({ meeting }: { meeting: TodoMeeting }) {
  const [summary, setSummary] = useState<MeetingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("ai_summaries")
      .select("executive_summary, key_points")
      .eq("meeting_id", meeting.id)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) setError(err.message);
        else setSummary((data as MeetingSummary | null) ?? null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [meeting.id]);

  const keyPoints = toStringList(summary?.key_points).slice(0, 4);

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-surface-1 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            From meeting
          </p>
          <p className="text-base font-semibold">{meeting.title}</p>
        </div>
        <Button asChild size="sm" variant="outline" className="rounded-full">
          <Link to="/meetings/$id" params={{ id: meeting.id }}>
            Open meeting <ArrowUpRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>
      {loading && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading the meeting summary…
        </p>
      )}
      {error && <p className="text-xs text-destructive">Could not load the summary: {error}</p>}
      {!loading && !error && !summary?.executive_summary && (
        <p className="text-xs text-muted-foreground">This meeting has no summary yet.</p>
      )}
      {summary?.executive_summary && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> Meeting summary
          </p>
          <p className="text-sm text-muted-foreground">{summary.executive_summary}</p>
          {keyPoints.length > 0 && (
            <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
              {keyPoints.map((pt, i) => (
                <li key={i}>{pt}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function TaskDetailDialog({
  task,
  meeting,
  onClose,
  onMove,
  onDelete,
}: {
  task: TodoTask | null;
  meeting: TodoMeeting | undefined;
  onClose: () => void;
  onMove: (taskId: string, status: TaskStatus) => void;
  onDelete: (taskId: string) => void;
}) {
  return (
    <Dialog open={!!task} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        {task && (
          <div className="space-y-5">
            <DialogHeader>
              <Badge className={`w-fit border-transparent ${taskStatusClass(task.status)}`}>
                {TODO_STATUS_LABEL[task.status]}
              </Badge>
              <DialogTitle className="text-xl leading-snug">{task.title}</DialogTitle>
              <DialogDescription className="sr-only">Task details</DialogDescription>
            </DialogHeader>

            <div className="flex flex-wrap gap-2" role="group" aria-label="Change status">
              {TASK_STATUSES.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={s === task.status ? "default" : "outline"}
                  className="rounded-full"
                  aria-pressed={s === task.status}
                  onClick={() => onMove(task.id, s)}
                >
                  {TODO_STATUS_LABEL[s]}
                </Button>
              ))}
            </div>

            <dl className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-surface-1 p-4 sm:grid-cols-2">
              <div className="flex items-center gap-3">
                <UserRound className="h-4 w-4 text-primary" aria-hidden />
                <div>
                  <dt className="text-xs uppercase tracking-widest text-muted-foreground">
                    Assigned to
                  </dt>
                  <dd className="text-sm font-semibold">{task.assignee || "Unassigned"}</dd>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <CalendarDays className="h-4 w-4 text-primary" aria-hidden />
                <div>
                  <dt className="text-xs uppercase tracking-widest text-muted-foreground">Due</dt>
                  <dd className="text-sm font-semibold">
                    {task.deadline
                      ? formatDeadlineFrom(task.deadline, taskReferenceDate(task, meeting))
                      : "No due date"}
                  </dd>
                </div>
              </div>
            </dl>

            {meeting ? (
              <MeetingContext meeting={meeting} />
            ) : (
              <p className="rounded-2xl border border-border bg-surface-1 p-4 text-xs text-muted-foreground">
                This task was assigned to you from a meeting you do not host.
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  onDelete(task.id);
                  onClose();
                }}
              >
                <Trash2 className="h-4 w-4" /> Delete task
              </Button>
              <div className="flex flex-wrap items-center gap-2">
                {task.meeting_id && meeting && (
                  <Button
                    asChild
                    size="sm"
                    className="gradient-bg rounded-full text-primary-foreground shadow-glow"
                  >
                    <Link to="/meetings/$id" params={{ id: task.meeting_id }}>
                      <Mail className="h-4 w-4" aria-hidden /> Open Meeting & Share Recap
                    </Link>
                  </Button>
                )}
                <Button variant="outline" size="sm" className="rounded-full" onClick={onClose}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
