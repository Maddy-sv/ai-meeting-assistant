import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatDuration } from "@/lib/mock-data";
import { useServerFn } from "@tanstack/react-start";
import { summarizeMeeting } from "@/lib/ai.functions";
import { ArrowLeft, Download, Mail, Mic, Pause, Play, Sparkles, Users, Video, Circle, ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/meetings/$id")({
  head: () => ({ meta: [{ title: "Meeting — Zeta" }] }),
  component: MeetingDetail,
});

type Meeting = { id: string; title: string; platform: string; status: string; started_at: string | null; ended_at: string | null; duration_seconds: number | null; meeting_link: string | null; host_id: string };
type Transcript = { id: string; speaker: string; content: string; spoken_at: string; segment_index: number };
type Participant = { id: string; name: string; email: string | null; role: string | null };
type Summary = { executive_summary: string | null; key_points: string[]; risks: string[]; follow_ups: string[] };
type Action = { id: string; title: string; assignee: string | null; deadline: string | null; status: string };
type Decision = { id: string; description: string; made_by: string | null };

function MeetingDetail() {
  const { id } = Route.useParams();
  const router = useRouter();
  const [m, setM] = useState<Meeting | null>(null);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [live, setLive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    const [mm, tt, pp, ss, aa, dd] = await Promise.all([
      supabase.from("meetings").select("*").eq("id", id).maybeSingle(),
      supabase.from("transcripts").select("*").eq("meeting_id", id).order("segment_index"),
      supabase.from("participants").select("*").eq("meeting_id", id),
      supabase.from("ai_summaries").select("*").eq("meeting_id", id).maybeSingle(),
      supabase.from("action_items").select("*").eq("meeting_id", id),
      supabase.from("decisions").select("*").eq("meeting_id", id),
    ]);
    setM(mm.data as Meeting | null);
    setTranscripts((tt.data as Transcript[]) ?? []);
    setParticipants((pp.data as Participant[]) ?? []);
    setSummary(ss.data ? (ss.data as any) : null);
    setActions((aa.data as Action[]) ?? []);
    setDecisions((dd.data as Decision[]) ?? []);
  }
  useEffect(() => { load(); }, [id]);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [transcripts.length]);

  function startLive() {
    setLive(true); setPaused(false); setElapsed(0);
    let i = 0;
    timerRef.current = setInterval(async () => {
      setElapsed((e) => e + 3);
      if (paused) return;
      const line = DEMO_LINES[i % DEMO_LINES.length];
      i++;
      const seg = transcripts.length + i;
      await supabase.from("transcripts").insert({ meeting_id: id, speaker: line.s, content: line.t, segment_index: seg });
      await load();
    }, 3000);
  }

  function stopLive() {
    if (timerRef.current) clearInterval(timerRef.current);
    setLive(false);
  }

  async function endMeeting() {
    stopLive();
    await supabase.from("meetings").update({ status: "completed", ended_at: new Date().toISOString(), duration_seconds: elapsed, started_at: m?.started_at ?? new Date(Date.now() - elapsed * 1000).toISOString() }).eq("id", id);

    // AI summary simulation
    if (!summary) {
      await supabase.from("ai_summaries").insert({
        meeting_id: id,
        executive_summary: "Team synced on progress. Marcus will circulate a detailed migration timeline; Priya highlighted the need for security sign-off before rollout.",
        key_points: ["Migration progress reviewed", "Timeline to be shared by EOD", "Security sign-off required"],
        risks: ["Rollout blocked until security review"],
        follow_ups: ["Send recap email", "Schedule security review"],
      });
      await supabase.from("action_items").insert([
        { meeting_id: id, title: "Draft migration timeline", assignee: "Marcus Reed", deadline: new Date(Date.now() + 86400000).toISOString() },
        { meeting_id: id, title: "Schedule security review", assignee: "Priya Shah", deadline: new Date(Date.now() + 2 * 86400000).toISOString() },
      ]);
      await supabase.from("decisions").insert({ meeting_id: id, description: "Timeline to be circulated by EOD", made_by: "Anna Chen" });
    }
    toast.success("Meeting ended — AI summary ready");
    await load();
  }

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const emailDraft = useMemo(() => {
    if (!summary) return "";
    return `Hi team,\n\nHere's a quick recap of "${m?.title}":\n\n${summary.executive_summary}\n\nAction items:\n${actions.map(a => `- ${a.title}${a.assignee ? ` (${a.assignee})` : ""}`).join("\n")}\n\nDecisions:\n${decisions.map(d => `- ${d.description}`).join("\n")}\n\nBest,\nZeta`;
  }, [summary, actions, decisions, m]);

  if (!m) return <p className="text-sm text-muted-foreground">Loading…</p>;

  function download() {
    const text = transcripts.map(t => `[${new Date(t.spoken_at).toLocaleTimeString()}] ${t.speaker}: ${t.content}`).join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${m?.title}-transcript.txt`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <button onClick={() => router.history.back()} className="glass inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs">
        <ArrowLeft className="h-3 w-3" /> Back
      </button>

      <header className="glass flex flex-wrap items-center justify-between gap-4 rounded-3xl p-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-white/10">{m.platform.replace("_", " ")}</Badge>
            <Badge className={m.status === "completed" ? "" : "gradient-bg"}>{m.status}</Badge>
            {live && <Badge className="animate-pulse bg-red-500/80"><Circle className="mr-1 h-2 w-2 fill-current" /> Recording</Badge>}
          </div>
          <h1 className="mt-2 truncate text-2xl font-black">{m.title}</h1>
          <div className="mt-1 text-xs text-muted-foreground">
            {m.started_at && <>Started {new Date(m.started_at).toLocaleString()} · </>}
            {m.duration_seconds ? formatDuration(m.duration_seconds) : live ? formatDuration(elapsed) : "Not started"}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!live && m.status !== "completed" && (
            <Button onClick={startLive} className="gradient-bg rounded-full shadow-glow">
              <Video className="mr-2 h-4 w-4" /> Join as AI Assistant
            </Button>
          )}
          {live && (
            <>
              <Button variant="outline" className="glass rounded-full border-white/10" onClick={() => setPaused(p => !p)}>
                {paused ? <Play className="mr-2 h-4 w-4" /> : <Pause className="mr-2 h-4 w-4" />}
                {paused ? "Resume" : "Pause"}
              </Button>
              <Button variant="destructive" className="rounded-full" onClick={endMeeting}>End meeting</Button>
            </>
          )}
          <Button variant="outline" className="glass rounded-full border-white/10" onClick={download}>
            <Download className="mr-2 h-4 w-4" /> Transcript
          </Button>
        </div>
      </header>

      <Tabs defaultValue="transcript">
        <TabsList className="glass border-white/10">
          <TabsTrigger value="transcript">Transcript</TabsTrigger>
          <TabsTrigger value="summary">AI Summary</TabsTrigger>
          <TabsTrigger value="actions">Actions & Decisions</TabsTrigger>
          <TabsTrigger value="email">Recap Email</TabsTrigger>
        </TabsList>

        <TabsContent value="transcript">
          <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
            <div ref={scrollRef} className="glass max-h-[60vh] overflow-y-auto rounded-2xl p-6">
              {transcripts.length === 0 && <p className="text-sm text-muted-foreground">No transcript yet. Join as AI Assistant to start capturing.</p>}
              <div className="space-y-3">
                {transcripts.map((t) => (
                  <div key={t.id} className="glass rounded-xl p-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{t.speaker}</span>
                      <span>{new Date(t.spoken_at).toLocaleTimeString()}</span>
                    </div>
                    <div className="mt-1 text-sm">{t.content}</div>
                  </div>
                ))}
              </div>
            </div>
            <aside className="glass h-fit rounded-2xl p-5">
              <div className="mb-3 flex items-center gap-2"><Users className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">Participants</h3></div>
              <div className="space-y-2">
                {participants.length === 0 && <p className="text-xs text-muted-foreground">None yet.</p>}
                {participants.map((p) => (
                  <div key={p.id} className="text-sm">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.email}{p.role ? ` · ${p.role}` : ""}</div>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </TabsContent>

        <TabsContent value="summary">
          {!summary ? (
            <div className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground">Summary will appear here once the meeting ends.</div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="glass rounded-2xl p-6 md:col-span-2">
                <div className="mb-2 flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><h3 className="font-semibold">Executive summary</h3></div>
                <p className="text-sm text-muted-foreground">{summary.executive_summary}</p>
              </div>
              <SummaryList title="Key discussion points" items={summary.key_points} />
              <SummaryList title="Risks" items={summary.risks} />
              <SummaryList title="Follow-up tasks" items={summary.follow_ups} />
            </div>
          )}
        </TabsContent>

        <TabsContent value="actions">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="glass rounded-2xl p-6">
              <h3 className="mb-3 font-semibold">Action items</h3>
              <div className="space-y-2">
                {actions.length === 0 && <p className="text-sm text-muted-foreground">No actions yet.</p>}
                {actions.map((a) => (
                  <div key={a.id} className="glass rounded-xl p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium">{a.title}</div>
                      <Badge variant={a.status === "done" ? "secondary" : "outline"} className="border-white/10">{a.status}</Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{a.assignee ?? "Unassigned"}{a.deadline ? ` · ${new Date(a.deadline).toLocaleDateString()}` : ""}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="glass rounded-2xl p-6">
              <h3 className="mb-3 font-semibold">Decisions</h3>
              <div className="space-y-2">
                {decisions.length === 0 && <p className="text-sm text-muted-foreground">No decisions logged.</p>}
                {decisions.map((d) => (
                  <div key={d.id} className="glass rounded-xl p-3">
                    <div className="font-medium">{d.description}</div>
                    {d.made_by && <div className="mt-1 text-xs text-muted-foreground">— {d.made_by}</div>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="email">
          <div className="glass rounded-2xl p-6">
            <div className="mb-3 flex items-center gap-2"><Mail className="h-4 w-4 text-primary" /><h3 className="font-semibold">Recap email draft</h3></div>
            <pre className="glass whitespace-pre-wrap rounded-xl p-4 text-sm">{emailDraft || "Summary required first."}</pre>
            <div className="mt-4 flex gap-2">
              <Button className="gradient-bg rounded-full shadow-glow" onClick={() => toast.success("Opening Gmail…")}>
                <Mail className="mr-2 h-4 w-4" /> Send via Gmail
              </Button>
              <Button variant="outline" className="glass rounded-full border-white/10" onClick={() => { navigator.clipboard.writeText(emailDraft); toast.success("Copied to clipboard"); }}>Copy</Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* previous-meeting memory */}
      <section className="glass rounded-2xl p-6">
        <div className="mb-2 flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><h3 className="font-semibold">Meeting memory</h3></div>
        <p className="text-sm text-muted-foreground">Zeta remembers prior meetings, pending tasks and previous decisions to brief you before every call. <Link to="/chat" className="text-primary">Ask AI →</Link></p>
      </section>
    </div>
  );
}

function SummaryList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="glass rounded-2xl p-6">
      <h3 className="mb-3 font-semibold">{title}</h3>
      <ul className="space-y-2 text-sm">
        {(items ?? []).map((it, i) => (
          <li key={i} className="glass rounded-xl px-3 py-2">{it}</li>
        ))}
        {(!items || items.length === 0) && <p className="text-xs text-muted-foreground">None.</p>}
      </ul>
    </div>
  );
}
