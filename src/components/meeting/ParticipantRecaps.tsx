import { Copy, ExternalLink, Loader2, Mail, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { MeetingTasks } from "@/hooks/use-meeting-tasks";
import { copyText, openInGmail, openInMailApp } from "./utils";

export function ParticipantRecaps({
  tasks,
  hasSummary,
  hasTranscript,
  hasParticipants,
}: {
  tasks: MeetingTasks;
  hasSummary: boolean;
  hasTranscript: boolean;
  hasParticipants: boolean;
}) {
  const { recaps, generatingRecaps, summarizing } = tasks;
  const busy = generatingRecaps || summarizing;

  return (
    <section className="glass rounded-2xl p-6" aria-labelledby="recaps-heading">
      <div className="mb-3 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" aria-hidden />
          <div>
            <h3 id="recaps-heading" className="text-lg font-semibold">
              Individual Participant Tasks & Recaps
            </h3>
            <p className="text-xs text-muted-foreground">
              Generates customized messages for each participant highlighting their specific
              deliverables.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => void tasks.generateRecaps()}
          disabled={busy || !hasParticipants || (!hasSummary && !hasTranscript)}
          className="gradient-bg rounded-full text-primary-foreground"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {generatingRecaps
            ? "Generating..."
            : hasSummary
              ? "Generate Individual Recaps"
              : "Generate Summary & Recaps"}
        </Button>
      </div>

      {recaps.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
          {!hasParticipants
            ? "Add participants to create individual recaps."
            : !hasSummary && !hasTranscript
              ? "Record or paste a transcript first, so a summary can be generated."
              : "Click Generate Individual Recaps to break down tasks and send personal notes to each attendee."}
        </p>
      ) : (
        <ul className="space-y-4">
          {recaps.map((r, i) => (
            <li
              key={`${r.participantName}-${i}`}
              className="rounded-xl border border-border bg-surface-1 p-4"
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm font-semibold">
                <span>{r.participantName}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {r.email || "No email saved"}
                </span>
              </div>
              <pre className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 font-mono text-xs leading-relaxed">
                {r.body}
              </pre>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="rounded-full"
                  onClick={() => {
                    openInGmail(r.email || "", r.subject, r.body);
                    toast.success(`Opening Gmail to send to ${r.participantName}...`);
                  }}
                >
                  <ExternalLink className="h-4 w-4" /> Send via Gmail
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => {
                    openInMailApp(r.email || "", r.subject, r.body);
                    toast.success(`Opening Mail app for ${r.participantName}...`);
                  }}
                >
                  <Mail className="h-4 w-4" /> Send via Mail App
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={async () => {
                    if (await copyText(r.body))
                      toast.success(`Copied recap for ${r.participantName}!`);
                    else toast.error("Could not copy to the clipboard.");
                  }}
                >
                  <Copy className="h-4 w-4" /> Copy Message
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
