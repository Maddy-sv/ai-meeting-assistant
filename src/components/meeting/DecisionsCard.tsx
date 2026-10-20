import { useState } from "react";
import { Gavel, Loader2, Plus, Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import type { MeetingTasks } from "@/hooks/use-meeting-tasks";
import type { Decision } from "./types";

function AddDecisionDialog({ tasks }: { tasks: MeetingTasks }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [madeBy, setMadeBy] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) return;
    setSaving(true);
    const ok = await tasks.createDecision({ description, madeBy });
    setSaving(false);
    if (ok) {
      setOpen(false);
      setDescription("");
      setMadeBy("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="rounded-full">
          <Plus className="h-4 w-4" /> Add decision
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record a decision</DialogTitle>
          <DialogDescription>Log an agreement that was made in this meeting.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="decision-description">Decision</Label>
            <Textarea
              id="decision-description"
              required
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="decision-made-by">Decided by (optional)</Label>
            <Input
              id="decision-made-by"
              value={madeBy}
              onChange={(e) => setMadeBy(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !description.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save decision
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DecisionsCard({
  decisions,
  tasks,
  readOnly = false,
}: {
  decisions: Decision[];
  tasks: MeetingTasks;
  readOnly?: boolean;
}) {
  return (
    <section className="glass rounded-2xl p-6" aria-labelledby="decisions-heading">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Gavel className="h-5 w-5 text-primary" aria-hidden />
          <h3 id="decisions-heading" className="text-lg font-semibold">
            Decisions
          </h3>
        </div>
        {!readOnly && <AddDecisionDialog tasks={tasks} />}
      </div>
      {decisions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No decisions recorded for this meeting.</p>
      ) : (
        <ul className="space-y-2">
          {decisions.map((d) => (
            <li
              key={d.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-border bg-surface-1 p-3"
            >
              <div>
                <p className="text-sm font-medium">{d.description}</p>
                {d.made_by && <p className="mt-1 text-xs text-muted-foreground">{d.made_by}</p>}
              </div>
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 hover:text-destructive"
                  aria-label="Delete decision"
                  onClick={() => void tasks.deleteDecision(d.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
