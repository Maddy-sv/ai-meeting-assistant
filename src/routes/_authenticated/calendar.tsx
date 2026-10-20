import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import {
  Bell,
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Download,
  Link2,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Section,
  StatusBadge,
} from "@/components/layout";
import { ScheduleMeetingDialog } from "@/components/schedule/schedule-meeting-dialog";
import { useSession } from "@/lib/auth";
import { platformLabel, safeExternalUrl } from "@/lib/format";
import { createMeetings, dataKeys, listMyMeetings, type MeetingListRow } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import { normalizeMeetingStatus } from "@/components/layout/status";

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({ meta: [{ title: "Calendar — AI Powered Meeting Companion" }] }),
  component: CalendarPage,
});

const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type GoogleEvent = {
  id?: string;
  status?: string;
  summary?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string };
};

function calendarRedirect() {
  return `${window.location.origin}/calendar`;
}

function CalendarPage() {
  const { session } = useSession();
  const user = session?.user ?? null;
  const userId = user?.id ?? "";
  const queryClient = useQueryClient();

  const meetings = useQuery({
    queryKey: dataKeys.myMeetings(userId),
    queryFn: () => listMyMeetings(userId),
    enabled: !!user,
  });

  const [month, setMonth] = useState(() => new Date());
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState<Date | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [tokenRejected, setTokenRejected] = useState(false);

  const googleLinked = !!user?.identities?.some((i) => i.provider === "google");
  const providerToken = session?.provider_token ?? null;
  const canImport = googleLinked && !!providerToken && !tokenRejected;

  const scheduled = useMemo(
    () =>
      (meetings.data ?? [])
        .filter((m): m is MeetingListRow & { scheduled_at: string } => !!m.scheduled_at)
        .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)),
    [meetings.data],
  );

  const monthStart = startOfMonth(month);
  const days = useMemo(() => {
    const result: Date[] = [];
    const end = endOfWeek(endOfMonth(monthStart));
    for (let d = startOfWeek(monthStart); d <= end; d = addDays(d, 1)) result.push(d);
    return result;
  }, [monthStart]);

  function meetingsOn(day: Date) {
    return scheduled.filter((m) => isSameDay(new Date(m.scheduled_at), day));
  }

  const tomorrowCount = meetingsOn(addDays(new Date(), 1)).filter(
    (m) => normalizeMeetingStatus(m.status) !== "completed",
  ).length;

  // Agenda (small screens): meetings in the visible month grouped by day.
  const agenda = useMemo(() => {
    const groups = new Map<string, { day: Date; items: typeof scheduled }>();
    for (const m of scheduled) {
      const d = new Date(m.scheduled_at);
      if (!isSameMonth(d, monthStart)) continue;
      const key = format(d, "yyyy-MM-dd");
      const group = groups.get(key) ?? { day: d, items: [] };
      group.items.push(m);
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [scheduled, monthStart]);

  function openSchedule(day: Date | null) {
    setScheduleDate(day);
    setScheduleOpen(true);
  }

  async function connectGoogle() {
    setConnecting(true);
    const { error } = await supabase.auth.linkIdentity({
      provider: "google",
      options: { scopes: GOOGLE_CALENDAR_SCOPE, redirectTo: calendarRedirect() },
    });
    if (error) {
      console.error("[calendar] linkIdentity failed", error);
      toast.error("Could not connect Google Calendar. Please try again.");
      setConnecting(false);
    }
  }

  async function reconnectGoogle() {
    setConnecting(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        scopes: GOOGLE_CALENDAR_SCOPE,
        redirectTo: calendarRedirect(),
        queryParams: { prompt: "consent" },
      },
    });
    if (error) {
      console.error("[calendar] Google reconnect failed", error);
      toast.error("Could not reconnect Google. Please try again.");
      setConnecting(false);
    }
  }

  async function importFromGoogle() {
    if (!user || !providerToken) {
      setTokenRejected(true);
      return;
    }
    setImporting(true);
    try {
      const params = new URLSearchParams({
        timeMin: new Date().toISOString(),
        maxResults: "50",
        singleEvents: "true",
        orderBy: "startTime",
      });
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
        { headers: { Authorization: `Bearer ${providerToken}` } },
      );
      if (res.status === 401 || res.status === 403) {
        setTokenRejected(true);
        throw new Error("Google access has expired. Reconnect Google to import.");
      }
      if (!res.ok) throw new Error("Could not load events from Google Calendar.");
      const body = (await res.json()) as { items?: GoogleEvent[] };
      const timed = (body.items ?? []).filter(
        (e): e is GoogleEvent & { id: string; start: { dateTime: string } } =>
          !!e.id && !!e.start?.dateTime && e.status !== "cancelled",
      );
      if (timed.length === 0) {
        toast.info("No upcoming timed events found in your Google Calendar.");
        return;
      }

      const { data: existing, error } = await supabase
        .from("meetings")
        .select("google_event_id")
        .eq("host_id", user.id)
        .in(
          "google_event_id",
          timed.map((e) => e.id),
        );
      if (error) throw new Error("Could not check which events are already imported.");
      const known = new Set((existing ?? []).map((r) => r.google_event_id));
      const fresh = timed.filter((e) => !known.has(e.id));
      if (fresh.length === 0) {
        toast.info("Everything from Google Calendar is already imported.");
        return;
      }

      await createMeetings(
        fresh.map((e) => {
          const link = safeExternalUrl(e.hangoutLink);
          return {
            hostId: user.id,
            title: e.summary?.trim().slice(0, 120) || "Untitled event",
            platform: link ? "google_meet" : "manual",
            meetingLink: link,
            scheduledAt: new Date(e.start.dateTime).toISOString(),
            projectId: null,
            googleEventId: e.id,
          };
        }),
      );
      const skipped = timed.length - fresh.length;
      toast.success(
        `Imported ${fresh.length} event${fresh.length === 1 ? "" : "s"} from Google Calendar` +
          (skipped ? ` (${skipped} already imported).` : "."),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["meetings"] }),
        queryClient.invalidateQueries({ queryKey: ["user-dashboard"] }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import from Google failed.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Calendar"
        description="See your schedule at a glance and plan new meetings."
        actions={
          <Button variant="brand" onClick={() => openSchedule(new Date())}>
            <CalendarPlus /> Schedule meeting
          </Button>
        }
      />

      <Section card title="Google Calendar">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {!googleLinked
              ? "Connect your Google account to import upcoming events as meetings (read-only access)."
              : canImport
                ? "Google is connected. Import brings in your upcoming events; events you already imported are skipped."
                : "Google is connected, but import needs fresh access. Google only shares calendar access for a short time after you sign in, so reconnect to import again."}
          </p>
          <div className="flex shrink-0 flex-wrap gap-2">
            {!googleLinked && (
              <Button variant="glass" onClick={connectGoogle} disabled={connecting}>
                {connecting ? <Loader2 className="animate-spin" /> : <Link2 />}
                Connect Google Calendar
              </Button>
            )}
            {googleLinked && canImport && (
              <Button variant="glass" onClick={importFromGoogle} disabled={importing}>
                {importing ? <Loader2 className="animate-spin" /> : <Download />}
                {importing ? "Importing…" : "Import from Google"}
              </Button>
            )}
            {googleLinked && !canImport && (
              <Button variant="glass" onClick={reconnectGoogle} disabled={connecting}>
                {connecting ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Reconnect Google to import
              </Button>
            )}
          </div>
        </div>
      </Section>

      {tomorrowCount > 0 && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-2xl bg-info/10 px-4 py-3 text-sm text-info"
        >
          <Bell className="h-4 w-4 shrink-0" aria-hidden />
          You have {tomorrowCount} meeting{tomorrowCount === 1 ? "" : "s"} scheduled for tomorrow.
        </div>
      )}

      <section aria-labelledby="calendar-month" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="calendar-month" className="text-2xl font-black" aria-live="polite">
            {format(month, "MMMM yyyy")}
          </h2>
          <div className="flex items-center gap-2">
            <Button
              variant="glass"
              size="icon"
              aria-label="Previous month"
              onClick={() => setMonth((m) => subMonths(m, 1))}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="glass"
              aria-label="Go to the current month"
              onClick={() => setMonth(new Date())}
            >
              Today
            </Button>
            <Button
              variant="glass"
              size="icon"
              aria-label="Next month"
              onClick={() => setMonth((m) => addMonths(m, 1))}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>

        {meetings.isLoading && <LoadingState variant="table" rows={5} label="Loading calendar…" />}
        {meetings.isError && (
          <ErrorState message={meetings.error.message} onRetry={() => meetings.refetch()} />
        )}

        {meetings.data && (
          <>
            {/* Month grid: tablets and up */}
            <div className="glass hidden overflow-hidden rounded-3xl md:block">
              <div className="grid grid-cols-7 border-b border-border bg-surface-1">
                {WEEKDAYS.map((d) => (
                  <div
                    key={d}
                    className="py-3 text-center text-xs font-bold uppercase tracking-widest text-muted-foreground"
                  >
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-px bg-border">
                {days.map((d) => {
                  const items = meetingsOn(d);
                  const inMonth = isSameMonth(d, monthStart);
                  const today = isToday(d);
                  return (
                    <div
                      key={d.toISOString()}
                      className={cn(
                        "flex min-h-28 flex-col gap-1 p-1.5",
                        inMonth ? "bg-background" : "bg-surface-1 text-muted-foreground",
                        today && "ring-1 ring-inset ring-primary/60",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => openSchedule(d)}
                        aria-label={`Schedule a meeting on ${format(d, "EEEE d MMMM yyyy")}${
                          items.length
                            ? `, ${items.length} meeting${items.length === 1 ? "" : "s"}`
                            : ""
                        }`}
                        className={cn(
                          "flex items-center justify-end rounded-md px-1.5 py-1 text-sm font-bold transition hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          today && "text-primary",
                        )}
                      >
                        {format(d, "d")}
                      </button>
                      <ul className="space-y-1">
                        {items.map((m) => (
                          <li key={m.id}>
                            <Link
                              to="/meetings/$id"
                              params={{ id: m.id }}
                              className="block rounded-md bg-primary/15 px-2 py-1 text-xs leading-tight text-foreground transition hover:bg-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <span className="font-semibold text-primary">
                                {format(new Date(m.scheduled_at), "HH:mm")}
                              </span>
                              <span className="block truncate">{m.title}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Agenda list: phones */}
            <div className="md:hidden">
              {agenda.length === 0 ? (
                <EmptyState
                  icon={CalendarDays}
                  title={`Nothing scheduled in ${format(month, "MMMM")}`}
                  description="Schedule a meeting or import events from Google Calendar."
                  action={
                    <Button variant="brand" onClick={() => openSchedule(new Date())}>
                      <CalendarPlus /> Schedule meeting
                    </Button>
                  }
                />
              ) : (
                <ol className="space-y-5">
                  {agenda.map((group) => (
                    <li key={group.day.toISOString()}>
                      <h3
                        className={cn(
                          "mb-2 text-sm font-semibold",
                          isToday(group.day) ? "text-primary" : "text-muted-foreground",
                        )}
                      >
                        {isToday(group.day) ? "Today · " : ""}
                        {format(group.day, "EEEE d MMMM")}
                      </h3>
                      <ul className="space-y-2">
                        {group.items.map((m) => (
                          <li key={m.id}>
                            <Link
                              to="/meetings/$id"
                              params={{ id: m.id }}
                              className="glass flex items-center gap-3 rounded-2xl p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <span className="w-12 shrink-0 text-sm font-bold text-primary">
                                {format(new Date(m.scheduled_at), "HH:mm")}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium">{m.title}</span>
                                <span className="block text-xs text-muted-foreground">
                                  {platformLabel(m.platform)}
                                </span>
                              </span>
                              <StatusBadge kind="meeting" status={m.status} />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </>
        )}
      </section>

      <ScheduleMeetingDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        defaultDate={scheduleDate}
        sendConfirmation
        title={
          scheduleDate
            ? `Schedule for ${format(scheduleDate, "d MMMM yyyy")}`
            : "Schedule a meeting"
        }
      />
    </div>
  );
}
