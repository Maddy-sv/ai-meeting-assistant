import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CalendarDays,
  Gavel,
  History,
  ListTodo,
  Loader2,
  RefreshCw,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getMeetingBriefing } from "@/lib/briefing.functions";
import { taskStatusClass, taskStatusLabel } from "./status";
import { errorMessage, formatDateTime, formatDeadline } from "./utils";

type Briefing = {
  previousMeetings: {
    id: string;
    title: string;
    date: string | null;
    executiveSummary: string | null;
  }[];
  openTasks: {
    id: string;
    title: string;
    assignee: string | null;
    deadline: string | null;
    status: string;
    meetingTitle: string | null;
  }[];
  recentDecisions: { description: string; meetingTitle: string | null }[];
  narrative: string | null;
};

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof History;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4 text-primary" aria-hidden /> {title}
      </h3>
      {children}
    </section>
  );
}

export function BriefingPanel({ meetingId }: { meetingId: string }) {
  const fetchBriefing = useServerFn(getMeetingBriefing);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = (await fetchBriefing({ data: { meetingId } })) as Briefing;
      setBriefing(res);
    } catch (err) {
      setError(errorMessage(err, "Could not load the briefing."));
    } finally {
      setLoading(false);
    }
  }, [fetchBriefing, meetingId]);

  useEffect(() => {
    void load();
  }, [load]);

  const empty =
    !!briefing &&
    briefing.previousMeetings.length === 0 &&
    briefing.openTasks.length === 0 &&
    briefing.recentDecisions.length === 0 &&
    !briefing.narrative;

  return (
    <section className="glass space-y-5 rounded-3xl p-5 sm:p-6" aria-labelledby="briefing-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="briefing-heading" className="text-lg font-semibold">
            Pre-meeting briefing
          </h2>
          <p className="text-xs text-muted-foreground">
            Context from your earlier meetings in this project, or your most recent meetings.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="rounded-full"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh
        </Button>
      </div>

      {loading && !briefing && (
        <div className="space-y-3" role="status" aria-label="Loading briefing">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-10 w-3/4 rounded-xl" />
          <Skeleton className="h-10 w-2/3 rounded-xl" />
        </div>
      )}

      {error && !loading && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
          <p className="text-sm">{error}</p>
          <Button variant="outline" size="sm" className="rounded-full" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      )}

      {briefing && !error && empty && (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          There are no earlier completed meetings to brief you on yet. Once you finish and summarise
          meetings, their open tasks and decisions will show up here.
        </p>
      )}

      {briefing && !error && !empty && (
        <div className="space-y-6">
          {briefing.narrative && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-primary">
                <Sparkles className="h-3.5 w-3.5" aria-hidden /> AI briefing
              </p>
              <p className="whitespace-pre-wrap text-sm">{briefing.narrative}</p>
            </div>
          )}

          <Section icon={History} title="Previous meetings">
            {briefing.previousMeetings.length === 0 ? (
              <p className="text-xs text-muted-foreground">No earlier meetings found.</p>
            ) : (
              <ul className="space-y-2">
                {briefing.previousMeetings.map((m) => (
                  <li key={m.id} className="rounded-xl border border-border bg-surface-1 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link
                        to="/meetings/$id"
                        params={{ id: m.id }}
                        className="text-sm font-medium text-primary hover:underline"
                      >
                        {m.title}
                      </Link>
                      {m.date && (
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(m.date)}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {m.executiveSummary || "No summary was generated for this meeting."}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section icon={ListTodo} title="Open tasks">
            {briefing.openTasks.length === 0 ? (
              <p className="text-xs text-muted-foreground">No open tasks.</p>
            ) : (
              <ul className="space-y-2">
                {briefing.openTasks.map((t) => (
                  <li
                    key={t.id}
                    className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-border bg-surface-1 p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{t.title}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <UserRound className="h-3.5 w-3.5" aria-hidden />
                          {t.assignee || "Unassigned"}
                        </span>
                        {t.deadline && (
                          <span className="inline-flex items-center gap-1">
                            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                            {formatDeadline(t.deadline)}
                          </span>
                        )}
                        {t.meetingTitle && <span>From {t.meetingTitle}</span>}
                      </p>
                    </div>
                    <Badge className={`border-transparent ${taskStatusClass(t.status)}`}>
                      {taskStatusLabel(t.status)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section icon={Gavel} title="Recent decisions">
            {briefing.recentDecisions.length === 0 ? (
              <p className="text-xs text-muted-foreground">No recent decisions.</p>
            ) : (
              <ul className="space-y-2">
                {briefing.recentDecisions.map((d, i) => (
                  <li key={i} className="rounded-xl border border-border bg-surface-1 p-3 text-sm">
                    {d.description}
                    {d.meetingTitle && (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {d.meetingTitle}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </section>
  );
}
