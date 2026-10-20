import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Summary } from "./types";
import { toStringList } from "./utils";

function SummaryList({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="glass rounded-2xl p-6">
      <h3 className="mb-3 text-lg font-semibold">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">None recorded.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {items.map((it, i) => (
            <li key={i} className="rounded-xl bg-surface-1 px-3 py-2">
              {it}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SummaryTab({
  summary,
  hasTranscript,
  summarizing,
  onGenerate,
}: {
  summary: Summary | null;
  hasTranscript: boolean;
  summarizing: boolean;
  onGenerate: () => void;
}) {
  if (summarizing && !summary) {
    return (
      <div
        className="glass flex flex-col items-center gap-3 rounded-2xl p-10 text-center"
        role="status"
      >
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
        <p className="text-sm text-muted-foreground">Generating the summary from the transcript…</p>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="glass flex flex-col items-center gap-3 rounded-2xl p-10 text-center">
        <Sparkles className="h-8 w-8 text-primary" aria-hidden />
        <h3 className="text-lg font-semibold">No summary yet</h3>
        <p className="max-w-md text-sm text-muted-foreground">
          {hasTranscript
            ? "Generate a summary, action items and decisions from this meeting's transcript."
            : "A summary needs a transcript. Record the meeting or paste a transcript first."}
        </p>
        <Button
          onClick={onGenerate}
          disabled={!hasTranscript || summarizing}
          className="gradient-bg rounded-full text-primary-foreground shadow-glow"
        >
          <Sparkles className="h-4 w-4" /> Generate summary
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="glass rounded-2xl p-6 md:col-span-2">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            <h3 className="text-lg font-semibold">Executive summary</h3>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={onGenerate}
            disabled={summarizing || !hasTranscript}
          >
            {summarizing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Regenerate
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {summary.executive_summary || "The summary has no overview text."}
        </p>
      </section>
      <SummaryList title="Key discussion points" items={toStringList(summary.key_points)} />
      <SummaryList title="Risks" items={toStringList(summary.risks)} />
      <SummaryList title="Follow-ups" items={toStringList(summary.follow_ups)} />
    </div>
  );
}
