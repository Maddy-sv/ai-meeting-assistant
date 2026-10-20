import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { endOfDay, endOfWeek, format, isToday, startOfDay } from "date-fns";
import {
  ArrowRight,
  Bell,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  Clock,
  ExternalLink,
  ListChecks,
  MessageSquare,
  Sparkles,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Section,
  StatTile,
  StatusBadge,
} from "@/components/layout";
import { useUnreadNotificationCount } from "@/components/layout/notifications";
import { useDisplayName, useUser } from "@/lib/auth";
import { normalizeMeetingStatus } from "@/components/layout/status";

export const Route = createFileRoute("/_authenticated/user/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — AI Powered Meeting Companion" }] }),
  component: UserDashboard,
});

type MeetingRow = {
  id: string;
  title: string;
  platform: string;
  scheduled_at: string | null;
  started_at: string | null;
  created_at: string;
  status: string;
  duration_seconds: number | null;
  meeting_link: string | null;
};

interface DashboardData {
  meetings: MeetingRow[];
  summaryMeetingIds: Set<string>;
  openTasks: number;
}

const dashboardKey = (userId: string) => ["user-dashboard", userId] as const;

async function loadDashboard(userId: string): Promise<DashboardData> {
  const { data: meetings, error } = await supabase
    .from("meetings")
    .select(
      "id, title, platform, scheduled_at, started_at, created_at, status, duration_seconds, meeting_link",
    )
    .eq("host_id", userId)
    .order("scheduled_at", { ascending: true, nullsFirst: false });
  if (error) throw new Error("Could not load your meetings.");

  const [summaries, tasks] = await Promise.all([
    supabase
      .from("ai_summaries")
      .select("meeting_id, meetings!inner(host_id)")
      .eq("meetings.host_id", userId),
    supabase.rpc("my_open_task_count"),
  ]);
  if (summaries.error) throw new Error("Could not load your meeting summaries.");
  if (tasks.error) throw new Error("Could not load your tasks.");

  return {
    meetings: meetings ?? [],
    summaryMeetingIds: new Set((summaries.data ?? []).map((s) => s.meeting_id)),
    openTasks: tasks.data ?? 0,
  };
}

function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function formatDuration(seconds: number | null) {
  if (!seconds) return null;
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

function safeMeetingLink(link: string | null): string | null {
  if (!link) return null;
  try {
    const url = new URL(link);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function UserDashboard() {
  const user = useUser();
  const userId = user?.id ?? "";
  const name = useDisplayName();
  const firstName = name.split(" ")[0];
  const dashboard = useQuery({
    queryKey: dashboardKey(userId),
    queryFn: () => loadDashboard(userId),
    enabled: !!user,
  });
  const unread = useUnreadNotificationCount();

  const now = new Date();
  const meetings = dashboard.data?.meetings ?? [];
  const meetingsToday = meetings.filter(
    (m) => m.scheduled_at && isToday(new Date(m.scheduled_at)),
  ).length;
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const upcomingThisWeek = meetings.filter((m) => {
    if (!m.scheduled_at || normalizeMeetingStatus(m.status) === "completed") return false;
    const t = new Date(m.scheduled_at);
    return t >= now && t <= weekEnd;
  }).length;

  const todayStart = startOfDay(now);
  const upcoming = meetings
    .filter(
      (m) =>
        normalizeMeetingStatus(m.status) === "live" ||
        (normalizeMeetingStatus(m.status) === "upcoming" &&
          (!m.scheduled_at || new Date(m.scheduled_at) >= todayStart)),
    )
    .sort((a, b) => {
      if (
        normalizeMeetingStatus(a.status) === "live" &&
        normalizeMeetingStatus(b.status) !== "live"
      )
        return -1;
      if (
        normalizeMeetingStatus(b.status) === "live" &&
        normalizeMeetingStatus(a.status) !== "live"
      )
        return 1;
      if (!a.scheduled_at) return 1;
      if (!b.scheduled_at) return -1;
      return a.scheduled_at.localeCompare(b.scheduled_at);
    })
    .slice(0, 4);

  const recent = meetings
    .filter((m) => normalizeMeetingStatus(m.status) === "completed")
    .sort((a, b) =>
      (b.started_at ?? b.scheduled_at ?? b.created_at).localeCompare(
        a.started_at ?? a.scheduled_at ?? a.created_at,
      ),
    )
    .slice(0, 5);

  return (
    <div className="space-y-8 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          {format(now, "EEEE d MMMM")}
        </p>
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
          {greeting(now)}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="text-muted-foreground">
          Your meetings, summaries and action items in one place.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <StatTile
          label="Meetings today"
          icon={CalendarDays}
          loading={dashboard.isLoading}
          value={meetingsToday}
        />
        <StatTile
          label="Upcoming this week"
          icon={Clock}
          loading={dashboard.isLoading}
          value={upcomingThisWeek}
        />
        <StatTile
          label="Open tasks"
          icon={ListChecks}
          loading={dashboard.isLoading}
          value={dashboard.data?.openTasks ?? 0}
        />
        <StatTile
          label="Summaries"
          icon={Sparkles}
          loading={dashboard.isLoading}
          value={dashboard.data?.summaryMeetingIds.size ?? 0}
        />
        <StatTile
          label="Unread alerts"
          icon={Bell}
          loading={unread.isLoading}
          value={unread.isError ? "—" : (unread.data ?? 0)}
        />
      </div>

      <nav aria-label="Quick actions" className="flex flex-wrap gap-2">
        <Button asChild variant="brand">
          <Link to="/meetings">
            <Video /> New meeting
          </Link>
        </Button>
        <Button asChild variant="glass">
          <Link to="/calendar">
            <CalendarPlus /> Schedule
          </Link>
        </Button>
        <Button asChild variant="glass">
          <Link to="/todo">
            <ListChecks /> Tasks
          </Link>
        </Button>
        <Button asChild variant="glass">
          <Link to="/chat">
            <MessageSquare /> Ask about your meetings
          </Link>
        </Button>
      </nav>

      {dashboard.isLoading && <LoadingState variant="cards" rows={3} label="Loading meetings…" />}

      {dashboard.isError && (
        <ErrorState message={dashboard.error.message} onRetry={() => dashboard.refetch()} />
      )}

      {dashboard.data && meetings.length === 0 && (
        <EmptyState
          icon={Video}
          title="No meetings yet"
          description="Schedule your first meeting or start recording one from the Meetings page."
          action={
            <Button asChild variant="brand">
              <Link to="/calendar">
                <CalendarPlus /> Schedule a meeting
              </Link>
            </Button>
          }
        />
      )}

      {dashboard.data && meetings.length > 0 && (
        <div className="grid gap-8 xl:grid-cols-5">
          <Section
            className="xl:col-span-3"
            title="Upcoming meetings"
            actions={
              <Button asChild variant="link" size="sm">
                <Link to="/calendar">
                  Open calendar <ArrowRight />
                </Link>
              </Button>
            }
          >
            {upcoming.length === 0 ? (
              <EmptyState
                icon={CalendarDays}
                title="Nothing scheduled"
                description="Plan your next meeting from the calendar."
                action={
                  <Button asChild variant="glass" size="sm">
                    <Link to="/calendar">
                      <CalendarPlus /> Schedule a meeting
                    </Link>
                  </Button>
                }
              />
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2">
                {upcoming.map((m) => (
                  <UpcomingCard key={m.id} meeting={m} />
                ))}
              </ul>
            )}
          </Section>

          <Section
            className="xl:col-span-2"
            title="Recent meetings"
            actions={
              <Button asChild variant="link" size="sm">
                <Link to="/meetings">
                  All meetings <ArrowRight />
                </Link>
              </Button>
            }
          >
            {recent.length === 0 ? (
              <EmptyState
                icon={Sparkles}
                title="No completed meetings yet"
                description="Summaries appear here after a meeting ends."
              />
            ) : (
              <ul className="space-y-3">
                {recent.map((m) => {
                  const hasSummary = dashboard.data.summaryMeetingIds.has(m.id);
                  const when = m.started_at ?? m.scheduled_at;
                  const duration = formatDuration(m.duration_seconds);
                  return (
                    <li key={m.id}>
                      <Link
                        to="/meetings/$id"
                        params={{ id: m.id }}
                        className="glass flex items-center justify-between gap-3 rounded-2xl p-4 transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{m.title}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            {when && <span>{format(new Date(when), "d MMM yyyy")}</span>}
                            {duration && <span>· {duration}</span>}
                            {hasSummary && (
                              <span className="inline-flex items-center gap-1 text-success">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Summary ready
                              </span>
                            )}
                          </div>
                        </div>
                        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

function UpcomingCard({ meeting: m }: { meeting: MeetingRow }) {
  const link = safeMeetingLink(m.meeting_link);
  const when = m.scheduled_at ? new Date(m.scheduled_at) : null;
  return (
    <li className="glass flex flex-col rounded-2xl p-5 shadow-soft">
      <div className="flex items-start justify-between gap-2">
        <div className="gradient-bg grid h-9 w-9 place-items-center rounded-xl">
          <Video className="h-4 w-4 text-primary-foreground" />
        </div>
        <StatusBadge kind="meeting" status={m.status} />
      </div>
      <h3 className="mt-4 truncate text-lg font-semibold">{m.title}</h3>
      <div className="mt-1 space-y-1 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4" />
          {when ? format(when, "EEE d MMM") : "No date set"}
        </div>
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4" />
          {when ? format(when, "HH:mm") : "No time set"}
          {when && when <= endOfDay(new Date()) && when >= startOfDay(new Date()) && (
            <span className="text-primary">· Today</span>
          )}
        </div>
      </div>
      <div className="mt-5 flex gap-2">
        {link ? (
          <Button asChild variant="brand" size="sm" className="flex-1">
            <a href={link} target="_blank" rel="noopener noreferrer">
              <ExternalLink /> Join
            </a>
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="flex-1 rounded-full">
                <Button variant="brand" size="sm" className="w-full" disabled>
                  <ExternalLink /> Join
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>No meeting link added yet</TooltipContent>
          </Tooltip>
        )}
        <Button asChild variant="glass" size="sm" className="flex-1">
          <Link to="/meetings/$id" params={{ id: m.id }}>
            Open
          </Link>
        </Button>
      </div>
    </li>
  );
}
