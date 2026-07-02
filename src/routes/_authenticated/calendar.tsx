import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CalendarDays, Video, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({ meta: [{ title: "Calendar — Zeta" }] }),
  component: CalendarPage,
});

type Meeting = { id: string; title: string; scheduled_at: string | null; platform: string; meeting_link: string | null; status: string };

function CalendarPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  useEffect(() => {
    supabase.from("meetings").select("*").order("scheduled_at").then(({ data }) => setMeetings((data as Meeting[]) ?? []));
  }, []);

  const byDay = new Map<string, Meeting[]>();
  meetings.forEach((m) => {
    if (!m.scheduled_at) return;
    const d = new Date(m.scheduled_at).toDateString();
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(m);
  });
  const today = new Date().toDateString();
  const todaysMeetings = byDay.get(today) ?? [];

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Calendar</h1>
          <p className="text-sm text-muted-foreground">Upcoming meetings with AI reminders and daily agendas.</p>
        </div>
        <Button variant="outline" className="glass rounded-full border-white/10"><CalendarDays className="mr-2 h-4 w-4" /> Connect Google Calendar</Button>
      </header>

      <section className="glass rounded-2xl p-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-muted-foreground">Today's agenda</h2>
        {todaysMeetings.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing on the calendar for today.</p>
        ) : (
          <div className="space-y-2">
            {todaysMeetings.map((m) => <Row key={m.id} m={m} />)}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Upcoming</h2>
        {[...byDay.entries()].filter(([d]) => d !== today).map(([day, list]) => (
          <div key={day} className="glass rounded-2xl p-5">
            <div className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">{day}</div>
            <div className="space-y-2">{list.map((m) => <Row key={m.id} m={m} />)}</div>
          </div>
        ))}
      </section>
    </div>
  );
}

function Row({ m }: { m: Meeting }) {
  return (
    <div className="glass flex items-center gap-3 rounded-xl p-3">
      <div className="gradient-bg grid h-10 w-10 place-items-center rounded-lg"><Video className="h-4 w-4 text-primary-foreground" /></div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{m.title}</div>
        <div className="text-xs text-muted-foreground">{m.scheduled_at ? new Date(m.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""} · {m.platform.replace("_", " ")}</div>
      </div>
      <Link to="/meetings/$id" params={{ id: m.id }}>
        <Button size="sm" variant="outline" className="glass rounded-full border-white/10">Open</Button>
      </Link>
      {m.meeting_link && (
        <a href={m.meeting_link} target="_blank" rel="noreferrer">
          <Button size="sm" className="gradient-bg rounded-full"><ExternalLink className="mr-1 h-3 w-3" />Join</Button>
        </a>
      )}
    </div>
  );
}
