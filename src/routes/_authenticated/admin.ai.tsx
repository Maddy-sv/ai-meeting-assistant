import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Activity, AlertTriangle, Bot, Timer, Zap } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Section,
  StatTile,
} from "@/components/layout";
import { adminAiUsage } from "@/lib/rpc";

export const Route = createFileRoute("/_authenticated/admin/ai")({
  head: () => ({ meta: [{ title: "AI usage — Admin — AI Meeting Companion" }] }),
  component: AdminAi,
});

function formatMs(ms: number | null | undefined) {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

function AdminAi() {
  const usage = useQuery({ queryKey: ["admin", "ai"], queryFn: adminAiUsage });
  const u = usage.data;
  const byFunction = [...(u?.by_function ?? [])].sort((a, b) => b.count - a.count);
  const daily = u?.daily ?? [];
  const maxDaily = Math.max(1, ...daily.map((d) => d.count));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Administration"
        title="AI usage"
        description="Requests made to the AI model by every server function."
      />

      {usage.isError ? (
        <ErrorState message={usage.error.message} onRetry={() => usage.refetch()} />
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile
            label="Total requests"
            icon={Zap}
            loading={usage.isLoading}
            value={u?.total ?? 0}
          />
          <StatTile label="Today" icon={Activity} loading={usage.isLoading} value={u?.today ?? 0} />
          <StatTile
            label="Failures today"
            icon={AlertTriangle}
            loading={usage.isLoading}
            value={u?.failures_today ?? 0}
          />
          <StatTile
            label="Avg duration"
            icon={Timer}
            loading={usage.isLoading}
            value={formatMs(u?.avg_duration_ms)}
          />
        </div>
      )}

      {usage.isLoading && <LoadingState variant="table" rows={5} label="Loading AI usage…" />}

      {u && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Section title="By function">
            {byFunction.length === 0 ? (
              <EmptyState icon={Bot} title="No AI requests recorded yet" />
            ) : (
              <div className="glass overflow-x-auto rounded-2xl">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead>Function</TableHead>
                      <TableHead className="text-right">Requests</TableHead>
                      <TableHead className="text-right">Failures</TableHead>
                      <TableHead className="text-right">Failure rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byFunction.map((f) => (
                      <TableRow key={f.fn} className="border-border">
                        <TableCell className="font-mono text-xs">{f.fn}</TableCell>
                        <TableCell className="text-right tabular-nums">{f.count}</TableCell>
                        <TableCell
                          className={
                            "text-right tabular-nums " + (f.failures > 0 ? "text-destructive" : "")
                          }
                        >
                          {f.failures}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {f.count ? `${Math.round((f.failures / f.count) * 100)}%` : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Section>

          <Section title="Last 14 days" description="Requests per day.">
            {daily.length === 0 ? (
              <EmptyState icon={Activity} title="No activity in the last 14 days" />
            ) : (
              <ul className="glass space-y-2 rounded-2xl p-5" aria-label="Requests per day">
                {daily.map((d) => (
                  <li key={d.day} className="flex items-center gap-3 text-sm">
                    <span className="w-16 shrink-0 text-xs text-muted-foreground">
                      {format(parseISO(d.day), "d MMM")}
                    </span>
                    <span className="h-3 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-chart-1"
                        style={{ width: `${(d.count / maxDaily) * 100}%` }}
                      />
                    </span>
                    <span className="w-10 shrink-0 text-right tabular-nums">{d.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}
