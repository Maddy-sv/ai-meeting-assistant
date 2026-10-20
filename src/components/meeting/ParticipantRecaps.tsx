import { Copy, ExternalLink, Loader2, Mail, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { MeetingTasks } from "@/hooks/use-meeting-tasks";
import { copyText, openInGmail, openInMailApp } from "./utils";

export function ParticipantRecaps({
  tasks,
  hasSummary,
  hasParticipants,
}: {
  tasks: MeetingTasks;
  hasSummary: boolean;
  hasParticipants: boolean;
}) {
  const { recaps, generatingRecaps } = tasks;

  return (
    <section className="glass rounded-2xl p-6" aria-labelledby="recaps-heading">
      <div className="mb-3 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" aria-hidden />
          <div>
            <h3 id="recaps-heading" className="text-lg font-semibold">
              Individual recaps
            </h3>
            <p className="text-xs text-muted-foreground">
              A personal message for each participant listing the tasks assigned to them.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => void tasks.generateRecaps()}
          disabled={generatingRecaps || !hasSummary || !hasParticipants}
          className="gradient-bg rounded-full text-primary-foreground"
        >
          {generatingRecaps ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          Generate recaps
        </Button>
      </div>

      {recaps.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
          {!hasSummary
            ? "Generate the meeting summary first."
            : !hasParticipants
              ? "Add participants to create individual recaps."
              : "Generate recaps to prepare a message for each participant."}
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
                  onClick={() => openInGmail(r.email || "", r.subject, r.body)}
                >
                  <ExternalLink className="h-4 w-4" /> Gmail
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => openInMailApp(r.email || "", r.subject, r.body)}
                >
                  <Mail className="h-4 w-4" /> Mail app
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={async () => {
                    if (await copyText(r.body))
                      toast.success(`Copied the recap for ${r.participantName}.`);
                    else toast.error("Could not copy to the clipboard.");
                  }}
                >
                  <Copy className="h-4 w-4" /> Copy
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
