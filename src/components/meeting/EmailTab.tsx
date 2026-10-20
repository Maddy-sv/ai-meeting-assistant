import { Copy, Mail, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { MeetingTasks } from "@/hooks/use-meeting-tasks";
import { ParticipantRecaps } from "./ParticipantRecaps";
import { copyText } from "./utils";

export function EmailTab({
  draft,
  hasSummary,
  hasParticipants,
  tasks,
  onCompose,
}: {
  draft: { subject: string; body: string };
  hasSummary: boolean;
  hasParticipants: boolean;
  tasks: MeetingTasks;
  onCompose: () => void;
}) {
  return (
    <div className="space-y-6">
      <section className="glass rounded-2xl p-6" aria-labelledby="recap-email-heading">
        <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" aria-hidden />
            <div>
              <h3 id="recap-email-heading" className="text-lg font-semibold">
                Recap email
              </h3>
              <p className="text-xs text-muted-foreground">
                Built from this meeting's summary, action items and decisions.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={async () => {
                if (await copyText(draft.body)) toast.success("Email text copied.");
                else toast.error("Could not copy to the clipboard.");
              }}
            >
              <Copy className="h-4 w-4" /> Copy
            </Button>
            <Button
              size="sm"
              onClick={onCompose}
              className="gradient-bg rounded-full text-primary-foreground"
            >
              <Pencil className="h-4 w-4" /> Edit and send
            </Button>
          </div>
        </div>
        {!hasSummary && (
          <p className="mb-3 text-xs text-warning">
            This meeting has no summary yet, so the email only lists tasks and decisions.
          </p>
        )}
        <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl bg-surface-2 p-4 font-mono text-xs leading-relaxed">
          {draft.body}
        </pre>
      </section>
      <ParticipantRecaps tasks={tasks} hasSummary={hasSummary} hasParticipants={hasParticipants} />
    </div>
  );
}
