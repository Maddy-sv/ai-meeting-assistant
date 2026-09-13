import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CalendarDays, Bell, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  format,
  addDays,
  isSameMonth,
  isSameDay,
  isToday,
  addMonths,
  subMonths
} from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({ meta: [{ title: "Calendar — AI Powered Meeting Companion" }] }),
  component: CalendarPage,
});

type Meeting = { id: string; title: string; scheduled_at: string | null; platform: string; meeting_link: string | null; status: string };

function CalendarPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [isLinked, setIsLinked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());

  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");
  const [platform, setPlatform] = useState("google_meet");
  const [time, setTime] = useState("09:00");
  const [projectId, setProjectId] = useState<string>("none");
  const [projects, setProjects] = useState<{id: string, name: string}[]>([]);
  const [scheduling, setScheduling] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.identities) {
        setIsLinked(data.user.identities.some(id => id.provider === 'google'));
      }
    });
    supabase.from("meetings").select("*").order("scheduled_at").then(({ data }) => setMeetings((data as Meeting[]) ?? []));
    
    supabase.auth.getUser().then(({ data: u }) => {
      if (u.user) {
        supabase.from("projects").select("id, name").eq("owner_id", u.user.id).then(({ data }) => setProjects(data ?? []));
      }
    });
  }, []);

  async function connectCalendar() {
    setLoading(true);
    try {
      const { error } = await supabase.auth.linkIdentity({
        provider: 'google',
        options: {
          scopes: 'https://www.googleapis.com/auth/calendar.readonly',
          redirectTo: window.location.origin + '/calendar'
        }
      });
      if (error) throw error;
    } catch (e: any) {
      toast.error(e?.message || "Failed to link calendar");
      setLoading(false);
    }
  }

  async function syncCalendar() {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.provider_token;
      
      if (!token) {
        toast.error("No Google access token found. Please reconnect your calendar.");
        setLoading(false);
        return;
      }

      const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=" + new Date().toISOString() + "&maxResults=10&singleEvents=true&orderBy=startTime", {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (!res.ok) throw new Error("Failed to fetch events from Google");
      const data = await res.json();
      
      const newMeetings = data.items
        .filter((item: any) => item.start?.dateTime) 
        .map((item: any) => ({
          title: item.summary || "Untitled Event",
          scheduled_at: item.start.dateTime, 
          google_event_id: item.id,
          platform: "google_meet",
          meeting_link: item.hangoutLink || null,
          status: "upcoming"
        }));

      if (newMeetings.length > 0) {
        for (const m of newMeetings) {
          const { data: existing } = await supabase.from("meetings").select("id").eq("google_event_id", m.google_event_id).maybeSingle();
          if (!existing) {
            const { data: userData } = await supabase.auth.getUser();
            await supabase.from("meetings").insert({ ...m, host_id: userData.user!.id });
          }
        }
        const { data: refreshed } = await supabase.from("meetings").select("*").order("scheduled_at");
        setMeetings((refreshed as Meeting[]) ?? []);
        toast.success("Calendar synced!");
      } else {
        toast.info("No new events found.");
      }
    } catch (e: any) {
      toast.error(e?.message || "Sync failed");
    } finally {
      setLoading(false);
    }
  }

  function openScheduleModal(d: Date) {
    setSelectedDate(d);
    setScheduleModalOpen(true);
    setTitle("");
    setLink("");
    setTime("09:00");
    setProjectId("none");
  }

  async function scheduleMeeting(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedDate) return;
    setScheduling(true);
    
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not logged in");

      const [hours, minutes] = time.split(":");
      const meetingDate = new Date(selectedDate);
      meetingDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);

      const { error: insertError } = await supabase.from("meetings").insert({
        host_id: u.user.id,
        title,
        platform,
        meeting_link: link,
        project_id: projectId === "none" ? null : projectId,
        scheduled_at: meetingDate.toISOString(),
        status: "upcoming"
      });
      if (insertError) throw insertError;

      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      
      const res = await fetch("https://aasrwvttxzmqjlazsvmf.supabase.co/functions/v1/send-confirmation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          email: u.user.email,
          title,
          platform,
          link,
          time: meetingDate.toISOString()
        })
      });

      if (!res.ok) {
        console.error("Failed to send confirmation email", await res.text());
        toast.warning("Meeting created, but email confirmation failed.");
      } else {
        toast.success("Meeting scheduled & confirmation sent!");
      }

      setScheduleModalOpen(false);
      const { data } = await supabase.from("meetings").select("*").order("scheduled_at");
      setMeetings((data as Meeting[]) ?? []);
    } catch (err: any) {
      toast.error(err.message || "Failed to schedule meeting");
    } finally {
      setScheduling(false);
    }
  }

  // Calculate calendar grid dates
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const days = [];
  let day = startDate;
  while (day <= endDate) {
    days.push(day);
    day = addDays(day, 1);
  }

  // Heads up alert logic for tomorrow
  const tomorrow = addDays(new Date(), 1);
  const tomorrowsMeetings = meetings.filter(m => m.scheduled_at && isSameDay(new Date(m.scheduled_at), tomorrow));

  return (
    <div className="space-y-8 h-full flex flex-col pb-10">
      {tomorrowsMeetings.length > 0 && (
        <Alert className="border-blue-500/50 bg-blue-500/10 text-blue-200 shadow-glow shrink-0">
          <Bell className="h-4 w-4 stroke-blue-400" />
          <AlertTitle className="font-semibold text-blue-400">Heads up!</AlertTitle>
          <AlertDescription>
            You have {tomorrowsMeetings.length} meeting{tomorrowsMeetings.length === 1 ? "" : "s"} scheduled for tomorrow.
          </AlertDescription>
        </Alert>
      )}

      <header className="flex flex-wrap items-end justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Calendar</h1>
          <p className="text-sm text-muted-foreground">Visualize your schedule and upcoming work.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isLinked ? (
            <Button onClick={syncCalendar} disabled={loading} variant="outline" className="glass rounded-full border-white/10">
              <CalendarDays className="mr-2 h-4 w-4" /> {loading ? "Syncing..." : "Sync Events"}
            </Button>
          ) : (
            <Button onClick={connectCalendar} disabled={loading} variant="outline" className="glass rounded-full border-white/10">
              <CalendarDays className="mr-2 h-4 w-4" /> Connect Google Calendar
            </Button>
          )}
        </div>
      </header>

      <div className="glass rounded-3xl overflow-hidden border border-white/10 shadow-glow flex-1 flex flex-col min-h-[600px]">
        {/* Month Navigation */}
        <div className="flex items-center justify-between p-6 border-b border-white/10 bg-white/5 shrink-0">
          <h2 className="text-2xl font-black">{format(currentDate, "MMMM yyyy")}</h2>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setCurrentDate(subMonths(currentDate, 1))} className="glass rounded-full border-white/10">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={() => setCurrentDate(new Date())} className="glass rounded-full border-white/10 font-semibold px-6">
              Today
            </Button>
            <Button variant="outline" size="icon" onClick={() => setCurrentDate(addMonths(currentDate, 1))} className="glass rounded-full border-white/10">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Days of Week Header */}
        <div className="grid grid-cols-7 border-b border-white/10 bg-black/40 shrink-0">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((dayName) => (
            <div key={dayName} className="py-4 text-center text-xs font-bold text-muted-foreground uppercase tracking-widest">
              {dayName}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 auto-rows-fr flex-1 bg-white/5 gap-[1px]">
          {days.map((d, i) => {
            const dayMeetings = meetings.filter(m => m.scheduled_at && isSameDay(new Date(m.scheduled_at), d));
            return (
              <div 
                key={i} 
                onClick={() => openScheduleModal(d)}
                className={`min-h-[120px] p-2 transition-colors hover:bg-white/10 flex flex-col cursor-pointer
                  ${!isSameMonth(d, monthStart) ? "text-muted-foreground/40 bg-black/60" : "bg-[#09090b]"} 
                  ${isToday(d) ? "bg-primary/5 ring-1 ring-inset ring-primary/50" : ""}
                `}
              >
                <div className={`text-right text-sm mb-2 font-bold ${isToday(d) ? "text-primary" : ""}`}>
                  {format(d, "d")}
                </div>
                <div className="space-y-1 flex-1 overflow-y-auto pr-1 custom-scrollbar">
                  {dayMeetings.map(m => (
                    <Link key={m.id} to="/meetings/$id" params={{ id: m.id }} className="block group" onClick={(e) => e.stopPropagation()}>
                      <div className="text-[11px] leading-tight rounded-md bg-blue-500/20 text-blue-200 px-2 py-1.5 border border-blue-500/20 group-hover:bg-blue-500/40 group-hover:border-blue-500/40 transition">
                        <span className="font-semibold opacity-80">{format(new Date(m.scheduled_at!), "h:mm a")}</span>
                        <div className="truncate font-medium mt-0.5">{m.title}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Dialog open={scheduleModalOpen} onOpenChange={setScheduleModalOpen}>
        <DialogContent className="glass border-white/10">
          <DialogHeader>
            <DialogTitle>Schedule for {selectedDate ? format(selectedDate, "MMMM d, yyyy") : ""}</DialogTitle>
          </DialogHeader>
          <form onSubmit={scheduleMeeting} className="space-y-4">
            <div>
              <Label>Topic / Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} required className="glass mt-1 border-white/10" placeholder="e.g. Project Sync" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Platform</Label>
                <Select value={platform} onValueChange={setPlatform}>
                  <SelectTrigger className="glass mt-1 border-white/10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="google_meet">Google Meet</SelectItem>
                    <SelectItem value="teams">Microsoft Teams</SelectItem>
                    <SelectItem value="manual">Manual link</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Time</Label>
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} required className="glass mt-1 border-white/10" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Meeting link (Optional)</Label>
                <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" className="glass mt-1 border-white/10" />
              </div>
              <div>
                <Label>Project (Optional)</Label>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger className="glass mt-1 border-white/10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Project</SelectItem>
                    {projects.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button type="submit" disabled={scheduling} className="gradient-bg w-full rounded-full">
              {scheduling ? "Scheduling..." : "Schedule Meeting"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
