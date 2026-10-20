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
}: {
  tasks: MeetingTasks;
  participants: Participant[];
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
          <Plus className="h-4 w-4" /> Add task
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add action item</DialogTitle>
          <DialogDescription>
            The task is linked to this meeting and your To-do board.
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
            <Label htmlFor="task-assignee">Assignee (optional)</Label>
            <Input
              id="task-assignee"
              list="task-assignee-options"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            />
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
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Add task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ActionRow({ a, tasks }: { a: ActionItem; tasks: MeetingTasks }) {
  const done = normalizeTaskStatus(a.status) === "done";
  const checkboxId = `action-${a.id}`;
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-1 p-3.5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Checkbox
          id={checkboxId}
          checked={done}
          onCheckedChange={() => void tasks.toggleTask(a)}
          aria-label={done ? `Mark "${a.title}" as not done` : `Mark "${a.title}" as done`}
          className="h-5 w-5"
        />
        <div className="min-w-0 flex-1">
          <label
            htmlFor={checkboxId}
            className={`block cursor-pointer text-sm font-medium ${done ? "text-muted-foreground line-through" : ""}`}
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
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 hover:text-destructive"
          aria-label={`Delete task "${a.title}"`}
          onClick={() => void tasks.deleteTask(a.id)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </li>
  );
}

export function ActionItemsCard({
  actions,
  participants,
  hasSummary,
  hasTranscript,
  tasks,
}: {
  actions: ActionItem[];
  participants: Participant[];
  hasSummary: boolean;
  hasTranscript: boolean;
  tasks: MeetingTasks;
}) {
  const busy = tasks.syncingTasks || tasks.summarizing;
  return (
    <section className="glass rounded-2xl p-6" aria-labelledby="actions-heading">
      <div className="mb-4 flex flex-col justify-between gap-3 border-b border-border pb-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <CheckSquare className="h-5 w-5 text-primary" aria-hidden />
            <h3 id="actions-heading" className="text-lg font-semibold">
              Action items
            </h3>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Tasks from this meeting also appear on your To-do board.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => void (hasSummary ? tasks.syncTasks() : tasks.generateSummary())}
            disabled={busy || !hasTranscript}
            className="gradient-bg rounded-full text-primary-foreground"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {hasSummary ? "Extract tasks with AI" : "Generate summary and tasks"}
          </Button>
          <AddTaskDialog tasks={tasks} participants={participants} />
          <Button asChild size="sm" variant="ghost" className="rounded-full text-primary">
            <Link to="/todo">
              To-do board <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
      {actions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground">No action items yet</p>
          <p className="mt-1 text-xs">
            {!hasTranscript
              ? "Record or paste a transcript, or add a task by hand."
              : hasSummary
                ? "Extract tasks from the transcript with AI, or add one by hand."
                : "Generate the summary to extract tasks, or add one by hand."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {actions.map((a) => (
            <ActionRow key={a.id} a={a} tasks={tasks} />
          ))}
        </ul>
      )}
    </section>
  );
}
