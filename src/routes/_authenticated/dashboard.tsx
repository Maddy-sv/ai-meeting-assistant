import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { seedIfEmpty, formatDuration } from "@/lib/mock-data";
import { Sparkles, Video, ListChecks, Clock, TrendingUp, ArrowRight, CalendarDays, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Zeta" }] }),
  component: Dashboard,
});

type Meeting = { id: string; title: string; platform: string; scheduled_at: string | null; started_at: string | null; status: string; duration_seconds: number | null };
type ActionItem = { id: string; title: string; assignee: string | null; deadline: string | null; status: string; meeting_id: string };
type Summary = { id: string; meeting_id: string; executive_summary: string | null };

function Dashboard() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      await seedIfEmpty(u.user.id);
      const [{ data: m }, { data: a }, { data: s }] = await Promise.all([
        supabase.from("meetings").select("*").order("scheduled_at", { ascending: true }),
        supabase.from("action_items").select("*").eq("status", "pending").order("deadline", { ascending: true }).limit(6),
        supabase.from("ai_summaries").select("*").limit(3),
      ]);
      setMeetings((m as Meeting[]) ?? []);
      setActions((a as ActionItem[]) ?? []);
      setSummaries((s as Summary[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const upcoming = meetings.filter((m) => m.status === "upcoming");
  const previous = meetings.filter((m) => m.status === "completed");
  const totalHours = Math.round(previous.reduce((s, m) => s + (m.duration_seconds ?? 0), 0) / 3600 * 10) / 10;

  const stats = [
    { label: "Total meetings", value: meetings.length, icon: Video },
    { label: "Hours saved", value: `${totalHours}h`, icon: Clock },
    { label: "Tasks completed", value: actions.length, icon: ListChecks },
    { label: "AI summaries", value: summaries.length, icon: Sparkles },
  ];

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Welcome back</div>
          <h1 className="mt-1 text-3xl font-black tracking-tight">Your meeting command center</h1>
        </div>
        <Link to="/meetings">
          <Button className="gradient-bg rounded-full shadow-glow">
            Start a meeting <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </Link>
      </header>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="glass rounded-2xl p-5">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">{s.label}</div>
              <s.icon className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-3 text-3xl font-black">{loading ? "—" : s.value}</div>
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Upcoming */}
        <section className="glass rounded-2xl p-6 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Upcoming meetings</h2>
            <Link to="/meetings" className="text-xs text-muted-foreground hover:text-foreground">See all →</Link>
          </div>
          <div className="space-y-2">
            {upcoming.length === 0 && <p className="text-sm text-muted-foreground">Nothing scheduled. Enjoy the focus time.</p>}
            {upcoming.map((m) => (
              <Link key={m.id} to="/meetings/$id" params={{ id: m.id }} className="glass flex items-center gap-3 rounded-xl p-3 transition hover:shadow-glow">
                <div className="gradient-bg grid h-10 w-10 place-items-center rounded-lg"><Video className="h-4 w-4 text-primary-foreground" /></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{m.title}</div>
                  <div className="text-xs text-muted-foreground">{m.platform.replace("_", " ")} · {m.scheduled_at ? new Date(m.scheduled_at).toLocaleString() : "TBD"}</div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </section>

        {/* Action items */}
        <section className="glass rounded-2xl p-6">
          <h2 className="mb-4 text-lg font-semibold">Pending action items</h2>
          <div className="space-y-2">
            {actions.length === 0 && <p className="text-sm text-muted-foreground">All caught up. 🎉</p>}
            {actions.map((a) => (
              <div key={a.id} className="glass rounded-xl p-3">
                <div className="text-sm font-medium">{a.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {a.assignee ?? "Unassigned"}{a.deadline ? ` · due ${new Date(a.deadline).toLocaleDateString()}` : ""}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Previous + AI summaries */}
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="glass rounded-2xl p-6 lg:col-span-2">
          <h2 className="mb-4 text-lg font-semibold">Previous meetings</h2>
          <div className="space-y-2">
            {previous.length === 0 && <p className="text-sm text-muted-foreground">No past meetings yet.</p>}
            {previous.map((m) => (
              <Link key={m.id} to="/meetings/$id" params={{ id: m.id }} className="glass flex items-center gap-3 rounded-xl p-3 transition hover:shadow-glow">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-white/5"><Video className="h-4 w-4" /></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{m.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {m.started_at ? new Date(m.started_at).toLocaleDateString() : ""} · {formatDuration(m.duration_seconds)}
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </section>

        <section className="glass rounded-2xl p-6">
          <div className="mb-3 flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <h2 className="text-lg font-semibold">AI briefing</h2>
          </div>
          <div className="space-y-3">
            {summaries.slice(0, 2).map((s) => (
              <div key={s.id} className="glass rounded-xl p-3 text-sm">
                <div className="line-clamp-4 text-muted-foreground">{s.executive_summary}</div>
              </div>
            ))}
            <Link to="/chat" className="glass flex items-center justify-between rounded-xl p-3 text-sm hover:shadow-glow">
              <span>Ask AI about your meetings</span>
              <TrendingUp className="h-4 w-4 text-primary" />
            </Link>
          </div>
        </section>
      </div>

      <div className="glass flex items-center gap-4 rounded-2xl p-5">
        <CalendarDays className="h-5 w-5 text-primary" />
        <div className="flex-1 text-sm">
          <div className="font-medium">Connect Google Calendar</div>
          <div className="text-xs text-muted-foreground">Sync your upcoming meetings and get AI reminders.</div>
        </div>
        <Link to="/calendar"><Button variant="outline" className="glass rounded-full border-white/10">Open calendar</Button></Link>
      </div>
    </div>
  );
}
