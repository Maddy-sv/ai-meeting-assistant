import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatDuration } from "@/lib/mock-data";
import { Video, Plus, ArrowRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/meetings/")({
  head: () => ({ meta: [{ title: "Meetings — AI Powered Meeting Companion" }] }),
  component: MeetingsList,
});

type Meeting = { id: string; title: string; platform: string; status: string; scheduled_at: string | null; started_at: string | null; duration_seconds: number | null; meeting_link: string | null };

function MeetingsList() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");
  const [platform, setPlatform] = useState("google_meet");
  const [projectId, setProjectId] = useState<string>("none");
  const [projects, setProjects] = useState<{id: string, name: string}[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    try {
      const saved = sessionStorage.getItem("selectedMeetings");
      if (saved) return new Set(JSON.parse(saved));
    } catch {}
    return new Set();
  });

  useEffect(() => {
    sessionStorage.setItem("selectedMeetings", JSON.stringify(Array.from(selectedIds)));
  }, [selectedIds]);

  const isSelectionMode = selectedIds.size > 0;

  async function load() {
    const { data: u } = await supabase.auth.getUser();
    if (u.user) {
      supabase.from("projects").select("id, name").eq("owner_id", u.user.id).then(({ data }) => setProjects(data ?? []));
    }
    const { data } = await supabase.from("meetings").select("*").order("created_at", { ascending: false });
    setMeetings((data as Meeting[]) ?? []);
  }
  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from("meetings").insert({
      host_id: u.user.id, title, platform, meeting_link: link,
      project_id: projectId === "none" ? null : projectId,
      scheduled_at: new Date().toISOString(), status: "upcoming",
    });
    if (error) return toast.error(error.message);
    toast.success("Meeting created");
    setOpen(false); setTitle(""); setLink(""); setProjectId("none");
    await load();
  }

  async function removeMeeting(id: string) {
    if (!window.confirm("Are you sure you want to delete this meeting?")) return;
    const { error } = await supabase.from("meetings").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Meeting removed");
    await load();
  }

  async function bulkRemove() {
    if (!window.confirm(`Are you sure you want to delete ${selectedIds.size} meetings?`)) return;
    const { error } = await supabase.from("meetings").delete().in("id", Array.from(selectedIds));
    if (error) return toast.error(error.message);
    toast.success(`${selectedIds.size} meetings removed`);
    setSelectedIds(new Set());
    await load();
  }

  function toggleSelection(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  const upcoming = meetings.filter((m) => m.status !== "completed");
  const past = meetings.filter((m) => m.status === "completed");

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Meetings</h1>
          <p className="text-sm text-muted-foreground">Connect a platform or add a meeting link and let AI Powered Meeting Companion join.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {isSelectionMode && (
            <Button variant="destructive" className="rounded-full shadow-glow" onClick={bulkRemove}>
              <Trash2 className="mr-2 h-4 w-4" /> Delete {selectedIds.size}
            </Button>
          )}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gradient-bg rounded-full shadow-glow"><Plus className="mr-2 h-4 w-4" /> New meeting</Button>
            </DialogTrigger>
          <DialogContent className="glass border-white/10">
            <DialogHeader><DialogTitle>Start a meeting</DialogTitle></DialogHeader>
            <form onSubmit={create} className="space-y-4">
              <div>
                <Label>Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} required className="glass mt-1 border-white/10" />
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
              <div>
                <Label>Meeting link</Label>
                <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" className="glass mt-1 border-white/10" />
              </div>
              <Button type="submit" className="gradient-bg w-full rounded-full">Create</Button>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-muted-foreground">Upcoming & live</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {upcoming.length === 0 && <p className="text-sm text-muted-foreground">No upcoming meetings.</p>}
          {upcoming.map((m) => (
            <MeetingCard 
              key={m.id} m={m} onRemove={removeMeeting} 
              selected={selectedIds.has(m.id)} onToggle={toggleSelection} isSelectionMode={isSelectionMode} 
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-muted-foreground">Past meetings</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {past.length === 0 && <p className="text-sm text-muted-foreground">No past meetings yet.</p>}
          {past.map((m) => (
            <MeetingCard 
              key={m.id} m={m} onRemove={removeMeeting} 
              selected={selectedIds.has(m.id)} onToggle={toggleSelection} isSelectionMode={isSelectionMode} 
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function MeetingCard({ 
  m, onRemove, selected, onToggle, isSelectionMode 
}: { 
  m: Meeting; onRemove: (id: string) => void; selected: boolean; onToggle: (id: string) => void; isSelectionMode: boolean 
}) {
  return (
    <div className={`glass group relative flex flex-col justify-between rounded-2xl p-5 transition hover:shadow-glow ${selected ? 'border-red-500/50 bg-red-500/10' : ''}`}>
      <Link to="/meetings/$id" params={{ id: m.id }} className="flex flex-col flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 pr-8">
            <div 
              className="mt-1 shrink-0 z-20" 
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(m.id); }}
            >
              <Checkbox 
                checked={selected} 
                className={`transition-opacity ${isSelectionMode || selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} data-[state=checked]:bg-red-500 data-[state=checked]:text-white border-white/20`} 
              />
            </div>
            <div className="min-w-0">
              <div className="truncate text-base font-semibold">{m.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {m.platform.replace("_", " ")} · {m.status}
                {m.scheduled_at && ` · ${new Date(m.scheduled_at).toLocaleString()}`}
                {m.duration_seconds ? ` · ${formatDuration(m.duration_seconds)}` : ""}
              </div>
            </div>
          </div>
          <div className="gradient-bg grid h-10 w-10 shrink-0 place-items-center rounded-xl">
            <Video className="h-4 w-4 text-primary-foreground" />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>Open meeting</span>
          <ArrowRight className="h-4 w-4" />
        </div>
      </Link>
      <Button 
        variant="ghost" 
        size="icon" 
        className="absolute right-2 top-2 z-10 opacity-0 transition group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-400 rounded-full"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRemove(m.id);
        }}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
