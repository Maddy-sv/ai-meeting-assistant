import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CalendarDays,
  CheckSquare,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MeetingTasks } from "@/hooks/use-meeting-tasks";
import { normalizeTaskStatus, taskStatusClass, taskStatusLabel } from "./status";
import type { ActionItem, Participant } from "./types";
import { formatDeadline } from "./utils";

function AddTaskDialog({
  tasks,
  participants,
  hostName,
}: {
  tasks: MeetingTasks;
  participants: Participant[];
  hostName: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [deadline, setDeadline] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    const ok = await tasks.createTask({ title, assignee, deadline });
    setSaving(false);
    if (ok) {
      setOpen(false);
      setTitle("");
      setAssignee("");
      setDeadline("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="rounded-full">
          <Plus className="h-4 w-4" /> Add Task
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Action Item</DialogTitle>
          <DialogDescription>
            Create a task linked directly to this meeting. It also appears on your To-Do list.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="task-title">Task</Label>
            <Input
              id="task-title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-assignee">Assignee</Label>
            <Input
              id="task-assignee"
              list="task-assignee-options"
              placeholder={hostName}
              aria-describedby="task-assignee-hint"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            />
            <p id="task-assignee-hint" className="text-xs text-muted-foreground">
              Leave empty to assign it to {hostName}.
            </p>
            <datalist id="task-assignee-options">
              {participants.map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-deadline">Due date (optional)</Label>
            <Input
              id="task-deadline"
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !title.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? "Adding..." : "Add to Meeting & To-Do"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ActionRow({
  a,
  tasks,
  readOnly,
}: {
  a: ActionItem;
  tasks: MeetingTasks;
  readOnly: boolean;
}) {
  const done = normalizeTaskStatus(a.status) === "done";
  const checkboxId = `action-${a.id}`;
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-1 p-3.5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Checkbox
          id={checkboxId}
          checked={done}
          onCheckedChange={() => void tasks.toggleTask(a)}
          disabled={readOnly}
          aria-label={done ? `Mark "${a.title}" as not done` : `Mark "${a.title}" as done`}
          className="h-5 w-5"
        />
        <div className="min-w-0 flex-1">
          <label
            htmlFor={checkboxId}
            className={`block text-sm ${readOnly ? "" : "cursor-pointer"} font-medium ${done ? "text-muted-foreground line-through" : ""}`}
          >
            {a.title}
          </label>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <UserRound className="h-3.5 w-3.5" aria-hidden /> {a.assignee || "Unassigned"}
            </span>
            {a.deadline && (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden /> {formatDeadline(a.deadline)}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge className={`border-transparent ${taskStatusClass(a.status)}`}>
          {taskStatusLabel(a.status)}
        </Badge>
        {!readOnly && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 hover:text-destructive"
            aria-label={`Delete task "${a.title}"`}
            onClick={() => void tasks.deleteTask(a.id)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </li>
  );
}

export function ActionItemsCard({
  actions,
  participants,
  hostName,
  hasSummary,
  hasTranscript,
  tasks,
  title = "Action Items & To-Do Sync",
  description = "Tasks from this meeting automatically sync with your personal To-Do list.",
  readOnly = false,
}: {
  actions: ActionItem[];
  participants: Participant[];
  hostName: string;
  hasSummary: boolean;
  hasTranscript: boolean;
  tasks: MeetingTasks;
  title?: string;
  description?: string;
  readOnly?: boolean;
}) {
  const busy = tasks.syncingTasks || tasks.summarizing;
  return (
    <section className="glass rounded-2xl p-6" aria-labelledby="actions-heading">
      <div className="mb-4 flex flex-col justify-between gap-3 border-b border-border pb-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <CheckSquare className="h-5 w-5 text-primary" aria-hidden />
            <h3 id="actions-heading" className="text-lg font-semibold">
              {title}
            </h3>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!readOnly && (
            <>
              <Button
                size="sm"
                onClick={() => void tasks.syncTasks()}
                disabled={busy || !hasTranscript}
                className="gradient-bg rounded-full text-primary-foreground"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {busy
                  ? "Generating & Extracting..."
                  : hasSummary
                    ? "Auto-Extract Tasks with AI"
                    : "Generate Summary & Tasks"}
              </Button>
              <AddTaskDialog tasks={tasks} participants={participants} hostName={hostName} />
            </>
          )}
          <Button asChild size="sm" variant="ghost" className="rounded-full text-primary">
            <Link to="/todo">
              Open To-Do List <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
      {actions.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground">
            No action items recorded for this meeting yet.
          </p>
          {readOnly ? (
            <p className="mt-1 text-xs">No tasks were recorded for this meeting.</p>
          ) : !hasTranscript ? (
            <p className="mt-1 text-xs">Record or paste a transcript, or add a task by hand.</p>
          ) : hasSummary ? (
            <p className="mt-1 text-xs">
              Click <strong className="text-foreground">Auto-Extract Tasks with AI</strong> above to
              extract tasks from the summary, or add one by hand.
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs">
                The meeting summary has not been generated yet, so action items have not been
                extracted.
              </p>
              <Button
                size="sm"
                onClick={() => void tasks.generateSummary()}
                disabled={tasks.summarizing}
                className="gradient-bg mt-3 rounded-full text-primary-foreground shadow-glow"
              >
                {tasks.summarizing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {tasks.summarizing ? "Generating Summary & Tasks..." : "Generate Summary & Tasks"}
              </Button>
            </>
          )}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {actions.map((a) => (
            <ActionRow key={a.id} a={a} tasks={tasks} readOnly={readOnly} />
          ))}
        </ul>
      )}
    </section>
  );
}
