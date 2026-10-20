import type { ComponentType, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  Gavel,
  ListChecks,
  ListTodo,
  Milestone,
  Users,
  Video,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StatTile, StatusBadge } from "@/components/layout";
import { safeFormatDeadline } from "@/lib/continuous-memory";
import type { ProjectSummaryReport, ProjectTaskEntry } from "@/lib/ai.functions";

function formatDate(value: string | null, pattern = "d MMM yyyy"): string {
  if (!value) return "Date not recorded";
  const d = new Date(value);
  return isNaN(d.getTime()) ? value : format(d, pattern);
}

function Block({
  title,
  icon: Icon,
  count,
  children,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 font-semibold">
        <Icon className="h-4 w-4 text-primary" aria-hidden />
        {title}
        {count !== undefined && (
          <Badge variant="muted" className="ml-1">
            {count}
          </Badge>
        )}
      </h3>
      {children}
    </section>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function BulletList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <Muted>{empty}</Muted>;
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-sm">
          <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 break-words text-muted-foreground">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function TaskList({ tasks, empty }: { tasks: ProjectTaskEntry[]; empty: string }) {
  if (tasks.length === 0) return <Muted>{empty}</Muted>;
  return (
    <ul className="divide-y divide-border rounded-xl border border-border">
      {tasks.map((t, i) => (
        <li
          key={`${t.title}-${i}`}
          className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between"
        >
          <div className="min-w-0 space-y-1">
            <p className="break-words text-sm font-medium">{t.title}</p>
            <p className="text-xs text-muted-foreground">
              <span>Owner: {t.assignee ?? "Unassigned"}</span>
              <span aria-hidden> · </span>
              <span>Due: {t.deadline ? safeFormatDeadline(t.deadline) : "No deadline"}</span>
              {t.meeting_id && t.meeting_title && (
                <>
                  <span aria-hidden> · </span>
                  <span>
                    From{" "}
                    <Link
                      to="/meetings/$id"
                      params={{ id: t.meeting_id }}
                      className="underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {t.meeting_title}
                    </Link>
                  </span>
                </>
              )}
            </p>
          </div>
          <StatusBadge kind="task" status={t.status} className="self-start" />
        </li>
      ))}
    </ul>
  );
}

export function ProjectSummaryReportView({ report }: { report: ProjectSummaryReport }) {
  const { stats } = report;
  return (
    <div className="space-y-8" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant={report.ai_enhanced ? "info" : "muted"}>
          {report.ai_enhanced ? "AI-enhanced" : "From saved records"}
        </Badge>
        <span>
          Generated{" "}
          <time dateTime={report.generated_at}>
            {formatDate(report.generated_at, "d MMM yyyy, HH:mm")}
          </time>
        </span>
      </div>

      <Block title="Overview" icon={Milestone}>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {report.overview || "No progress recorded yet."}
        </p>
      </Block>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Meetings"
          value={stats.meetings}
          icon={Video}
          hint={`${stats.completed_meetings} completed`}
        />
        <StatTile
          label="Tasks done"
          value={`${stats.tasks_done}/${stats.tasks_total}`}
          icon={CheckCircle2}
          hint={`${stats.tasks_open} open`}
        />
        <StatTile label="Decisions" value={stats.decisions} icon={Gavel} />
        <StatTile
          label="People"
          value={stats.participants.length}
          icon={Users}
          hint={
            stats.participants.length > 0 ? (
              <span className="line-clamp-2 break-words">{stats.participants.join(", ")}</span>
            ) : (
              "None recorded"
            )
          }
        />
      </div>

      <Block title="Meeting timeline" icon={CalendarDays} count={report.timeline.length}>
        {report.timeline.length === 0 ? (
          <Muted>No meetings recorded.</Muted>
        ) : (
          <ol className="space-y-4 border-l border-border pl-4">
            {report.timeline.map((m) => (
              <li key={m.meeting_id} className="relative space-y-1">
                <span
                  className="absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full bg-primary"
                  aria-hidden
                />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link
                    to="/meetings/$id"
                    params={{ id: m.meeting_id }}
                    className="min-w-0 break-words font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {m.title}
                  </Link>
                  <StatusBadge kind="meeting" status={m.status} />
                </div>
                <p className="text-xs text-muted-foreground">
                  <time dateTime={m.date}>{formatDate(m.date)}</time>
                </p>
                <p className="break-words text-sm text-muted-foreground">
                  {m.summary || "No summary has been generated for this meeting yet."}
                </p>
                {m.highlights.length > 0 && (
                  <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {m.highlights.map((h, i) => (
                      <li key={i} className="break-words">
                        {h}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </Block>

      <Block title="Key decisions" icon={Gavel} count={report.key_decisions.length}>
        {report.key_decisions.length === 0 ? (
          <Muted>No decisions recorded yet.</Muted>
        ) : (
          <ul className="space-y-3">
            {report.key_decisions.map((d, i) => (
              <li key={i} className="space-y-0.5 text-sm">
                <p className="break-words">{d.description}</p>
                <p className="text-xs text-muted-foreground">
                  {d.made_by ? `By ${d.made_by}` : "Owner not recorded"}
                  {d.meeting_title ? ` · ${d.meeting_title}` : ""}
                  {d.date ? ` · ${formatDate(d.date)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <div className="grid gap-8 lg:grid-cols-2">
        <Block title="Open tasks" icon={ListTodo} count={report.open_tasks.length}>
          <TaskList tasks={report.open_tasks} empty="No open tasks." />
        </Block>
        <Block title="Completed tasks" icon={CheckCircle2} count={report.completed_tasks.length}>
          <TaskList tasks={report.completed_tasks} empty="Nothing confirmed as completed yet." />
        </Block>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <Block title="Risks & blockers" icon={AlertTriangle} count={report.risks.length}>
          <BulletList items={report.risks} empty="No risks recorded." />
        </Block>
        <Block title="Next steps" icon={ListChecks} count={report.next_steps.length}>
          <BulletList items={report.next_steps} empty="No next steps recorded." />
        </Block>
      </div>

      <Block title="Suggested agenda" icon={ListChecks}>
        {report.suggested_agenda.length === 0 ? (
          <Muted>No agenda items suggested.</Muted>
        ) : (
          <ol className="space-y-2">
            {report.suggested_agenda.map((item, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary"
                  aria-hidden
                >
                  {i + 1}
                </span>
                <span className="min-w-0 break-words pt-0.5 text-muted-foreground">{item}</span>
              </li>
            ))}
          </ol>
        )}
      </Block>

      {report.discrepancies.length > 0 && (
        <Block
          title="Discrepancies to check"
          icon={AlertTriangle}
          count={report.discrepancies.length}
        >
          <div className="rounded-xl bg-warning/10 p-3">
            <BulletList items={report.discrepancies} empty="" />
          </div>
        </Block>
      )}
    </div>
  );
}
