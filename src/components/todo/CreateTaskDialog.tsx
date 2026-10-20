import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TASK_STATUSES, type TaskStatus } from "@/components/meeting/status";
import { TODO_STATUS_LABEL } from "./labels";
import type { NewTodoInput, TodoMeeting } from "@/hooks/use-todo-tasks";

export function CreateTaskDialog({
  meetings,
  defaultAssignee,
  onCreate,
}: {
  meetings: TodoMeeting[];
  defaultAssignee: string;
  onCreate: (input: NewTodoInput) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [meetingId, setMeetingId] = useState("");
  const [deadline, setDeadline] = useState("");
  const [status, setStatus] = useState<TaskStatus>("pending");
  const [saving, setSaving] = useState(false);

  function handleOpenChange(next: boolean) {
    if (next) {
      setTitle("");
      setAssignee("");
      setMeetingId(meetings[0]?.id ?? "");
      setDeadline("");
      setStatus("pending");
    }
    setOpen(next);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !meetingId) return;
    setSaving(true);
    const ok = await onCreate({ title, assignee, meetingId, deadline, status });
    setSaving(false);
    if (ok) setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button className="gradient-bg rounded-full text-primary-foreground shadow-glow">
          <Plus className="h-4 w-4" /> New task
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>Every task belongs to one of your meetings.</DialogDescription>
        </DialogHeader>
        {meetings.length === 0 ? (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>Create a meeting first, then add tasks to it.</p>
            <Button asChild className="rounded-full">
              <Link to="/meetings">Go to meetings</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-task-title">Task</Label>
              <Input
                id="new-task-title"
                required
                placeholder="e.g. Complete presentation slides"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-task-assignee">Assignee (optional)</Label>
              <Input
                id="new-task-assignee"
                value={assignee}
                placeholder={defaultAssignee || undefined}
                aria-describedby={defaultAssignee ? "new-task-assignee-hint" : undefined}
                onChange={(e) => setAssignee(e.target.value)}
              />
              {defaultAssignee && (
                <p id="new-task-assignee-hint" className="text-xs text-muted-foreground">
                  Leave blank to assign it to yourself ({defaultAssignee}).
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-task-meeting">Meeting</Label>
              <Select value={meetingId} onValueChange={setMeetingId}>
                <SelectTrigger id="new-task-meeting">
                  <SelectValue placeholder="Choose a meeting" />
                </SelectTrigger>
                <SelectContent>
                  {meetings.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new-task-deadline">Due date (optional)</Label>
                <Input
                  id="new-task-deadline"
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-task-status">Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                  <SelectTrigger id="new-task-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {TODO_STATUS_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !title.trim() || !meetingId}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />} Create task
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
