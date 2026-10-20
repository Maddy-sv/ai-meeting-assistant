import { useState } from "react";
import { Check, Loader2, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import type { MeetingTranscriptEdits } from "@/hooks/use-meeting-transcript-edits";
import type { Participant } from "./types";
import { getInitials, isSameName, speakerTone } from "./utils";

const ROLE_LABEL: Record<string, string> = {
  host: "Host",
  participant: "Participant",
  guest: "Guest",
  remote: "Remote",
  attendee: "Attendee",
};

function AddParticipantDialog({ edits }: { edits: MeetingTranscriptEdits }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("participant");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const ok = await edits.addParticipant({ name, email, role });
    setSaving(false);
    if (ok) {
      setOpen(false);
      setName("");
      setEmail("");
      setRole("participant");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full"
          aria-label="Add participant"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add participant</DialogTitle>
          <DialogDescription>
            Participants can be assigned tasks and receive recap emails.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="participant-name">Full name</Label>
            <Input
              id="participant-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="participant-email">Email (optional)</Label>
            <Input
              id="participant-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="participant-role">Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger id="participant-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="participant">Participant</SelectItem>
                <SelectItem value="guest">Guest</SelectItem>
                <SelectItem value="remote">Remote</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving || !name.trim()} className="rounded-full">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Add participant
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ParticipantRow({
  p,
  isHost,
  edits,
}: {
  p: Participant;
  isHost: boolean;
  edits: MeetingTranscriptEdits;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p.name);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await edits.renameParticipant(p, name);
    setEditing(false);
  }

  return (
    <li className="group flex items-center justify-between gap-2 rounded-xl border border-border bg-surface-1 p-3">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <div
          aria-hidden
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${speakerTone(p.name, isHost)}`}
        >
          {getInitials(p.name)}
        </div>
        {editing ? (
          <form onSubmit={save} className="flex min-w-0 flex-1 items-center gap-1.5">
            <Label htmlFor={`rename-${p.id}`} className="sr-only">
              New name for {p.name}
            </Label>
            <Input
              id={`rename-${p.id}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="h-8 min-w-0 flex-1 text-sm"
            />
            <Button type="submit" size="icon" className="h-8 w-8" aria-label="Save name">
              <Check className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Cancel rename"
              onClick={() => {
                setName(p.name);
                setEditing(false);
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </form>
        ) : (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{p.name}</p>
            <p className="truncate text-xs text-muted-foreground">{p.email || "No email"}</p>
          </div>
        )}
      </div>
      {!editing && (
        <div className="flex shrink-0 items-center gap-1">
          <Badge
            className={`border-transparent ${isHost ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}
          >
            {isHost ? "Host" : ROLE_LABEL[p.role || ""] || p.role || "Participant"}
          </Badge>
          <div className="flex items-center gap-1 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={`Rename ${p.name}`}
              onClick={() => {
                setName(p.name);
                setEditing(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            {!isHost && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:text-destructive"
                aria-label={`Remove ${p.name}`}
                onClick={() => void edits.removeParticipant(p)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

export function ParticipantsPanel({
  participants,
  hostName,
  edits,
}: {
  participants: Participant[];
  hostName: string;
  edits: MeetingTranscriptEdits;
}) {
  return (
    <aside aria-labelledby="participants-heading" className="glass h-fit space-y-4 rounded-3xl p-5">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" aria-hidden />
          <h2 id="participants-heading" className="text-sm font-semibold">
            Participants
          </h2>
          <Badge variant="secondary" className="rounded-full">
            {participants.length}
          </Badge>
        </div>
        <AddParticipantDialog edits={edits} />
      </div>
      {participants.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          No participants yet. You are added when recording starts, and remote speakers are added
          when they are heard.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {participants.map((p) => (
            <ParticipantRow
              key={p.id}
              p={p}
              isHost={p.role === "host" || isSameName(p.name, hostName)}
              edits={edits}
            />
          ))}
        </ul>
      )}
    </aside>
  );
}
