import { useState } from "react";
import { Copy, ExternalLink, Mail, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Participant } from "./types";
import { copyText, openInGmail, openInMailApp, participantEmails } from "./utils";

export function EmailTab({
  draft,
  hasSummary,
  participants,
  onCompose,
  readOnly = false,
}: {
  draft: { subject: string; body: string };
  hasSummary: boolean;
  participants: Participant[];
  onCompose: (to: string) => void;
  readOnly?: boolean;
}) {
  const [recipients, setRecipients] = useState("");

  function resolveRecipients(): string {
    return recipients.trim() || participantEmails(participants).join(", ");
  }

  function sendWithGmail() {
    openInGmail(resolveRecipients(), draft.subject, draft.body);
    toast.success("Opening Gmail compose window...");
  }

  function sendWithMailApp() {
    openInMailApp(resolveRecipients(), draft.subject, draft.body);
    toast.success("Opening your default mail app...");
  }

  async function copyEmail() {
    if (await copyText(draft.body)) toast.success("Full email recap copied to clipboard!");
    else toast.error("Could not copy to the clipboard.");
  }

  return (
    <section className="glass rounded-2xl p-6" aria-labelledby="recap-email-heading">
      <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-primary" aria-hidden />
          <div>
            <h3 id="recap-email-heading" className="text-lg font-semibold">
              Complete Meeting Recap Email
            </h3>
            <p className="text-xs text-muted-foreground">
              Ready-to-send email with the executive summary, action items and decisions.
            </p>
          </div>
        </div>
        {!readOnly && (
          <Button
            size="sm"
            onClick={() => onCompose(recipients.trim())}
            className="gradient-bg rounded-full text-primary-foreground"
          >
            <Pencil className="h-4 w-4" /> Customize & Send
          </Button>
        )}
      </div>

      {!readOnly && (
        <div className="mb-3 space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <Label htmlFor="recap-recipients" className="text-xs text-muted-foreground">
              Send to Email Address
            </Label>
            <span className="text-xs text-muted-foreground">
              Any email or a comma-separated list
            </span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="recap-recipients"
              type="text"
              inputMode="email"
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              placeholder={
                participantEmails(participants).length > 0
                  ? "Leave empty to send to all attendees with an email"
                  : "Enter recipient email addresses"
              }
              className="h-9 flex-1 rounded-xl text-xs"
            />
            <Button
              onClick={sendWithGmail}
              className="gradient-bg h-9 shrink-0 rounded-xl text-xs text-primary-foreground"
            >
              <ExternalLink className="h-4 w-4" /> Send with Gmail
            </Button>
          </div>
        </div>
      )}

      {!hasSummary && (
        <p className="mb-3 text-xs text-warning">
          This meeting has no summary yet, so the email only lists tasks and decisions.
        </p>
      )}
      <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl bg-surface-2 p-4 font-mono text-xs leading-relaxed">
        {draft.body}
      </pre>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!readOnly && (
          <>
            <Button
              size="sm"
              className="gradient-bg rounded-full text-primary-foreground"
              onClick={sendWithGmail}
            >
              <ExternalLink className="h-4 w-4" /> Open in Gmail
            </Button>
            <Button size="sm" variant="outline" className="rounded-full" onClick={sendWithMailApp}>
              <Mail className="h-4 w-4" /> Send via Mail App (Outlook / Apple Mail)
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          onClick={() => void copyEmail()}
        >
          <Copy className="h-4 w-4" /> Copy Email Content
        </Button>
      </div>
    </section>
  );
}
