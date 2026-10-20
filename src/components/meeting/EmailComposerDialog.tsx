import { useState } from "react";
import { Copy, ExternalLink, Mail, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Participant } from "./types";
import { copyText, openInGmail, openInMailApp, participantEmails } from "./utils";

function addRecipient(current: string, email: string): string {
  const list = current
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.some((e) => e.toLowerCase() === email.toLowerCase())) return current;
  return [...list, email].join(", ");
}

function ComposerBody({
  draft,
  participants,
  initialTo,
  onSent,
}: {
  draft: { subject: string; body: string };
  participants: Participant[];
  initialTo: string;
  onSent: () => void;
}) {
  const [to, setTo] = useState(() => initialTo || participantEmails(participants).join(", "));
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);

  const withEmail = participants.filter((p) => p.email);

  async function copy() {
    if (await copyText(body)) toast.success("Email text copied.");
    else toast.error("Could not copy to the clipboard.");
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email-to">To</Label>
        <Input
          id="email-to"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="Type email addresses, separated by commas"
        />
        {withEmail.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-xs text-muted-foreground">Quick add attendee:</span>
            {withEmail.map((p) => (
              <Button
                key={p.id}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 rounded-full text-xs"
                onClick={() => setTo((prev) => addRecipient(prev, p.email!))}
              >
                <Plus className="h-3 w-3" /> {p.name}
              </Button>
            ))}
            {withEmail.length > 1 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 rounded-full border-primary/30 text-xs text-primary"
                onClick={() =>
                  setTo((prev) =>
                    participantEmails(participants).reduce((acc, e) => addRecipient(acc, e), prev),
                  )
                }
              >
                <Plus className="h-3 w-3" /> Add All Attendees
              </Button>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No participant has an email address saved. Type the addresses above.
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="email-subject">Subject</Label>
        <Input id="email-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email-body">Message</Label>
        <Textarea
          id="email-body"
          rows={11}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="font-mono text-xs leading-relaxed"
        />
      </div>
      <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
        <Button
          type="button"
          variant="outline"
          className="rounded-full"
          onClick={() => void copy()}
        >
          <Copy className="h-4 w-4" /> Copy Email Content
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="rounded-full"
            onClick={() => openInMailApp(to, subject, body)}
          >
            <Mail className="h-4 w-4" /> Send via Mail App (Outlook / Apple Mail)
          </Button>
          <Button
            type="button"
            className="gradient-bg rounded-full text-primary-foreground"
            onClick={() => {
              openInGmail(to, subject, body);
              onSent();
            }}
          >
            <ExternalLink className="h-4 w-4" /> Send with Gmail
          </Button>
        </div>
      </div>
    </div>
  );
}

export function EmailComposerDialog({
  open,
  onOpenChange,
  draft,
  participants,
  initialTo = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: { subject: string; body: string };
  participants: Participant[];
  initialTo?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Share via Email</DialogTitle>
          <DialogDescription>
            Review the recap, then open it in Gmail or your mail app to send it.
          </DialogDescription>
        </DialogHeader>
        <ComposerBody
          draft={draft}
          participants={participants}
          initialTo={initialTo}
          onSent={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
