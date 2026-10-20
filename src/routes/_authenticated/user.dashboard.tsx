import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatDuration } from "@/lib/mock-data";
import {
  Sparkles,
  Video,
  ListChecks,
  CalendarDays,
  ArrowRight,
  Clock,
  Users,
  PlusCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/user/dashboard")({
  head: () => ({ meta: [{ title: "My Workspace — AI Powered Meeting Companion" }] }),
  component: UserDashboard,
});

type Meeting = {
  id: string;
  title: string;
  platform: string;
  scheduled_at: string | null;
  started_at: string | null;
  status: string;
  duration_seconds: number | null;
};
type ActionItem = {
  id: string;
  title: string;
  assignee: string | null;
  deadline: string | null;
  status: string;
  meeting_id: string;
};

function UserDashboard() {
  const [name, setName] = useState("");
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;

      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", u.user.id)
        .maybeSingle();
      const meta = u.user.user_metadata;
      const fullName = (
        prof?.full_name ||
        meta?.full_name ||
        meta?.name ||
        u.user.email?.split("@")[0] ||
        ""
      ).trim();
      const firstName = fullName.split(" ")[0].trim();
      setName(firstName || "there");

      const [{ data: m }, { data: a }] = await Promise.all([
        supabase.from("meetings").select("*").order("scheduled_at", { ascending: true }),
        supabase
          .from("action_items")
          .select("*")
          .eq("status", "pending")
          .order("deadline", { ascending: true }),
      ]);

      const meetingList = (m as Meeting[]) ?? [];
      const userMeetingIds = new Set(
        meetingList.filter((meeting) => meeting.host_id === u.user.id).map((meeting) => meeting.id),
      );

      const filteredActions = ((a as ActionItem[]) ?? []).filter((item) => {
        if (item.meeting_id && userMeetingIds.has(item.meeting_id)) return true;
        const assignee = (item.assignee || "").toLowerCase().trim();
        if (!assignee) return true;
        if (["you", "host", "me", "i", "myself", "current user"].includes(assignee)) return true;
        if (firstName && assignee.includes(firstName.toLowerCase())) return true;
        if (fullName && assignee.includes(fullName.toLowerCase())) return true;
        return false;
      });

      setMeetings(meetingList);
      setActions(filteredActions);
      setLoading(false);
    })();
  }, []);

  const upcoming = meetings.filter((m) => m.status === "upcoming");
  const previous = meetings.filter((m) => m.status === "completed").slice(0, 4);

  return (
    <div className="space-y-10 animate-in slide-in-from-bottom-4 duration-500">
      <header className="flex flex-col gap-2">
        <h1 className="text-4xl font-black tracking-tight">Good Morning, {name} 👋</h1>
        <p className="text-muted-foreground text-lg">
          Manage your meetings, summaries and action items all in one place.
        </p>
      </header>

      {/* AI Insights Bar */}
      <div className="relative overflow-hidden rounded-3xl p-6 bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-pink-500/10 border border-white/10 shadow-glow">
        <div className="absolute -left-4 -top-4 opacity-50">
          <Sparkles className="h-24 w-24 text-primary blur-xl" />
        </div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="gradient-bg grid h-12 w-12 place-items-center rounded-2xl shrink-0 shadow-lg">
              <Sparkles className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h3 className="font-bold text-lg">AI Meeting Insight</h3>
              <p className="text-sm text-foreground/80 mt-1">
                {actions.length > 0
                  ? `${actions.length} action items were identified from your recent meetings. Stay on top of them!`
                  : "You are completely caught up! No pending action items identified."}
              </p>
            </div>
          </div>
          <Link to="/todo">
            <Button
              variant="secondary"
              className="rounded-full bg-white/10 hover:bg-white/20 border border-white/10 backdrop-blur-md"
            >
              View Tasks <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Quick Actions */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <QuickAction
          to="/meetings"
          icon={Video}
          label="Start New Meeting"
          color="from-green-500/20 to-emerald-500/5"
          text="text-green-400"
        />
        <QuickAction
          to="/calendar"
          icon={CalendarDays}
          label="Schedule Meeting"
          color="from-blue-500/20 to-indigo-500/5"
          text="text-blue-400"
        />
        <QuickAction
          to="/meetings"
          icon={PlusCircle}
          label="Join Meeting"
          color="from-purple-500/20 to-pink-500/5"
          text="text-purple-400"
        />
        <QuickAction
          to="/meetings"
          icon={ListChecks}
          label="View Summaries"
          color="from-orange-500/20 to-amber-500/5"
          text="text-orange-400"
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Column */}
        <div className="lg:col-span-8 space-y-8">
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold">Upcoming Meetings</h2>
              <Link to="/meetings" className="text-sm text-primary hover:underline">
                View Calendar
              </Link>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              {upcoming.length === 0 && (
                <div className="glass col-span-2 rounded-3xl p-8 text-center text-muted-foreground border-dashed">
                  No upcoming meetings scheduled.
                </div>
              )}
              {upcoming.map((m) => (
                <div
                  key={m.id}
                  className="glass rounded-3xl p-6 hover:-translate-y-1 transition-transform border border-white/5 shadow-soft"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="gradient-bg p-2 rounded-xl">
                      <Video className="h-5 w-5 text-white" />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-white/10 px-2 py-1 rounded-full">
                      Upcoming
                    </span>
                  </div>
                  <h3 className="text-lg font-bold truncate">{m.title}</h3>
                  <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <CalendarDays className="h-4 w-4" />{" "}
                      {m.scheduled_at ? new Date(m.scheduled_at).toLocaleDateString() : "TBD"}
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4" />{" "}
                      {m.scheduled_at
                        ? new Date(m.scheduled_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "TBD"}
                    </div>
                  </div>
                  <Button className="w-full mt-6 rounded-full gradient-bg shadow-glow">
                    Join Room
                  </Button>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-4">Recent Meetings</h2>
            <div className="space-y-3">
              {previous.length === 0 && (
                <p className="text-muted-foreground">No recent meetings.</p>
              )}
              {previous.map((m) => (
                <div
                  key={m.id}
                  className="glass flex items-center justify-between p-4 rounded-2xl hover:bg-white/5 transition border border-white/5"
                >
                  <div className="flex items-center gap-4">
                    <div className="bg-white/10 p-3 rounded-xl">
                      <Users className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="font-bold">{m.title}</h4>
                      <div className="text-xs text-muted-foreground mt-1 flex gap-3">
                        <span>
                          {m.started_at ? new Date(m.started_at).toLocaleDateString() : ""}
                        </span>
                        <span>•</span>
                        <span>{formatDuration(m.duration_seconds)}</span>
                        <span>•</span>
                        <span className="text-green-400">Summary Ready</span>
                      </div>
                    </div>
                  </div>
                  <Link to="/meetings/$id" params={{ id: m.id }}>
                    <Button
                      variant="outline"
                      className="rounded-full border-white/10 glass hidden sm:flex"
                    >
                      View Summary
                    </Button>
                    <ArrowRight className="h-5 w-5 sm:hidden text-muted-foreground" />
                  </Link>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right Column */}
        <div className="lg:col-span-4 space-y-6">
          <div className="glass rounded-3xl p-6 border border-white/5 bg-gradient-to-b from-white/5 to-transparent">
            <h2 className="text-lg font-bold mb-4">Today's Overview</h2>
            <div className="space-y-4">
              <OverviewStat label="Meetings Today" value={upcoming.length.toString()} />
              <OverviewStat label="Total Meetings" value={meetings.length.toString()} />
              <OverviewStat label="Pending Action Items" value={actions.length.toString()} />
              <OverviewStat label="Unread Notifications" value="0" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuickAction({ to, icon: Icon, label, color, text }: any) {
  return (
    <Link
      to={to}
      className={`glass flex flex-col items-center justify-center p-6 rounded-3xl border border-white/5 transition hover:scale-105 hover:shadow-lg bg-gradient-to-b ${color}`}
    >
      <Icon className={`h-8 w-8 mb-3 ${text}`} />
      <span className="text-sm font-semibold text-center leading-tight">{label}</span>
    </Link>
  );
}

function OverviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="font-bold text-lg">{value}</span>
    </div>
  );
}
