import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatDuration } from "@/lib/mock-data";
import { useServerFn } from "@tanstack/react-start";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { summarizeMeeting, generateMeetingRecaps, transcribeRemoteAudio } from "@/lib/ai.functions";
import { ArrowLeft, Download, Mail, Mic, Pause, Play, Sparkles, Users, Video, Circle, ShieldCheck, Loader2, MonitorUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

function getFriendlyErrorMessage(err: any, defaultMsg: string): string {
  let msg = err?.message || defaultMsg;
  try {
    const parsed = JSON.parse(msg);
    if (parsed?.error?.message) {
      msg = parsed.error.message;
    }
  } catch {}
  
  if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
    return "AI Rate limit reached. Please wait a minute and try again.";
  }
  if (msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("high demand")) {
    return "The AI model is currently experiencing high demand. Please try again in a few moments.";
  }
  return msg;
}

export const Route = createFileRoute("/_authenticated/meetings/$id")({
  head: () => ({ meta: [{ title: "Meeting — AI Powered Meeting Companion" }] }),
  component: MeetingDetail,
});

type Meeting = { id: string; title: string; platform: string; status: string; started_at: string | null; ended_at: string | null; duration_seconds: number | null; meeting_link: string | null; host_id: string };
type Transcript = { id: string; speaker: string; content: string; spoken_at: string; segment_index: number; status?: "partial" | "final" };
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
  const [consentOpen, setConsentOpen] = useState(false);
  const [addLinkOpen, setAddLinkOpen] = useState(false);
  const [newLink, setNewLink] = useState("");
  const [interim, setInterim] = useState("");
  const [summarizing, setSummarizing] = useState(false);
  const [micSupported, setMicSupported] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState("en-US");
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const screenshotsRef = useRef<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recognitionRef = useRef<any>(null);
  const segCounterRef = useRef(0);
  const pausedRef = useRef(false);
  const speakerRef = useRef("You");
  const interimRef = useRef("");
  const streamRef = useRef<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const captureIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const remoteAudioRecorderRef = useRef<MediaRecorder | null>(null);
  const summarize = useServerFn(summarizeMeeting);
  const generateRecaps = useServerFn(generateMeetingRecaps);
  const transcribeRemote = useServerFn(transcribeRemoteAudio);
  const [studentRecaps, setStudentRecaps] = useState<any[]>([]);
  const [generatingRecaps, setGeneratingRecaps] = useState(false);
  const [activeTab, setActiveTab] = useState("transcript");

  const liveRef = useRef(false);
  const transcriptsRef = useRef<Transcript[]>([]);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { liveRef.current = live; }, [live]);
  useEffect(() => { transcriptsRef.current = transcripts; }, [transcripts]);

  useEffect(() => {
    if (m?.status === "completed" && !summarizing) {
      setActiveTab("summary");
    }
  }, [m?.status, summarizing]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts, interim]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      setMicSupported(!!SR);
    }
  }, []);

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
    segCounterRef.current = ((tt.data as Transcript[]) ?? []).length;
  }
  useEffect(() => { load(); }, [id]);

  async function beginRecording() {
    setConsentOpen(false);
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast.error("Your browser doesn't support live transcription. Try Chrome or Edge.");
      return;
    }

    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error("Microphone permission denied. Enable it in your browser to transcribe.");
      return;
    }

    const { data: user } = await supabase.auth.getUser();
    const { data: prof } = await supabase
      .from("profiles").select("full_name").eq("id", user.user?.id ?? "").maybeSingle();
    const speaker = (prof as any)?.full_name || user.user?.email?.split("@")[0] || "You";
    speakerRef.current = speaker;

    setLive(true); setPaused(false); setElapsed(0);
    await supabase.from("meetings").update({
      status: "in_progress",
      started_at: new Date().toISOString(),
    }).eq("id", id);

    timerRef.current = setInterval(() => {
      if (!pausedRef.current) setElapsed((e) => e + 1);
    }, 1000);

    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = selectedLanguage;

    rec.onresult = async (event: any) => {
      if (pausedRef.current) return;
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const text = res[0].transcript.trim();
        if (!text) continue;
        if (res.isFinal) {
          segCounterRef.current += 1;
          const newSeg: Transcript = {
            id: crypto.randomUUID(),
            meeting_id: id,
            speaker: speakerRef.current,
            content: text,
            segment_index: segCounterRef.current,
            spoken_at: new Date().toISOString(),
            status: "final"
          };
          
          let toUpsert: Transcript;
          
          setTranscripts(prev => {
            const updated = [...prev];
            const lastIndex = updated.length - 1;
            if (lastIndex >= 0 && updated[lastIndex].speaker === speakerRef.current) {
              updated[lastIndex] = { ...updated[lastIndex], content: updated[lastIndex].content + "\n\n" + text };
              toUpsert = updated[lastIndex];
              return updated;
            }
            toUpsert = newSeg;
            return [...updated, newSeg];
          });
          
          // Fire and forget upsert after state update guarantees toUpsert is set
          setTimeout(() => {
            if (toUpsert) {
              const { status, ...dbData } = toUpsert;
              supabase.from("transcripts").upsert(dbData).then(({ error }) => {
                if (error) console.error("Transcript upsert failed:", error);
              });
            }
          }, 0);
        } else {
          interimText += text + " ";
        }
      }
      setInterim(interimText);
      interimRef.current = interimText;
    };

    rec.onerror = (e: any) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        toast.error("Microphone access blocked.");
        stopLive();
      }
    };

    rec.onend = () => {
      if (liveRef.current && !pausedRef.current) {
        try { rec.start(); } catch { /* noop */ }
      }
    };

    try { rec.start(); } catch { /* noop */ }
    recognitionRef.current = rec;
    toast.success("Recording started — I'm listening.");
    
    startScreenShare();
  }

  async function startScreenShare() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      displayStreamRef.current = stream;
      setSharing(true);
      toast.success("Screen sharing started. Slides and remote audio will be captured.");

      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      video.play();

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        const audioStream = new MediaStream(audioTracks);
        try {
          const mr = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
          mr.ondataavailable = async (e) => {
            if (e.data && e.data.size > 0 && liveRef.current && !pausedRef.current) {
              const reader = new FileReader();
              reader.readAsDataURL(e.data);
              reader.onloadend = async () => {
                const base64 = reader.result as string;
                try {
                  segCounterRef.current += 1;
                  const res = await transcribeRemote({
                    data: {
                      meetingId: id,
                      base64Audio: base64,
                      segmentIndex: segCounterRef.current,
                      screenshotBase64: screenshotsRef.current.length > 0 ? screenshotsRef.current[screenshotsRef.current.length - 1] : undefined,
                    }
                  });
                  if (res && Array.isArray(res)) {
                    // Use ref to avoid stale closures and state updater anti-patterns
                    const current = [...transcriptsRef.current];
                    let toUpsert: Transcript[] = [];
                    for (const r of res) {
                      const lastIndex = current.length - 1;
                      if (lastIndex >= 0 && current[lastIndex].speaker === r.speaker) {
                        current[lastIndex] = {
                          ...current[lastIndex],
                          content: current[lastIndex].content + "\n\n" + r.content,
                          status: "partial"
                        };
                        toUpsert.push(current[lastIndex]);
                      } else {
                        if (lastIndex >= 0) current[lastIndex].status = "final";
                        const newSeg: Transcript = { ...r, id: crypto.randomUUID(), meeting_id: id };
                        current.push(newSeg);
                        toUpsert.push(newSeg);
                      }
                    }
                    setTranscripts(current);
                    
                    const dbPayload = toUpsert.map(({ status, ...rest }) => rest);
                    if (dbPayload.length > 0) {
                      supabase.from("transcripts").upsert(dbPayload).then(({ error }) => {
                        if (error) console.error("Remote transcript upsert failed", error);
                      });
                    }
                  }
                } catch (err) {
                  console.error("Remote transcription failed", err);
                }
              };
            }
          };
          mr.start(5000);
          remoteAudioRecorderRef.current = mr;
        } catch (err) {
          console.warn("Could not start MediaRecorder for remote audio", err);
        }
      } else {
        toast.error("No tab audio shared! You must check the 'Share tab audio' checkbox to transcribe other participants.");
      }

      captureIntervalRef.current = setInterval(() => {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        const ctx = canvas.getContext("2d");
        if (ctx && video.videoWidth) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.5);
          setScreenshots(prev => {
            const next = [...prev, dataUrl];
            screenshotsRef.current = next;
            return next;
          });
        }
      }, 5000);

      stream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
      };
    } catch (err) {
      toast.error("Screen sharing cancelled or failed.");
    }
  }

  function stopScreenShare() {
    if (captureIntervalRef.current) clearInterval(captureIntervalRef.current);
    captureIntervalRef.current = null;
    
    if (remoteAudioRecorderRef.current) {
      try { remoteAudioRecorderRef.current.stop(); } catch { /* noop */ }
      remoteAudioRecorderRef.current = null;
    }
    
    if (displayStreamRef.current) {
      displayStreamRef.current.getTracks().forEach((t) => t.stop());
      displayStreamRef.current = null;
    }
    setSharing(false);
  }

  function stopLive() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (recognitionRef.current) {
      try { recognitionRef.current.onend = null; recognitionRef.current.stop(); } catch { /* noop */ }
      recognitionRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    stopScreenShare();
    setLive(false);
    setInterim("");
    interimRef.current = "";
  }

  async function endMeeting() {
    if (interimRef.current.trim()) {
      segCounterRef.current += 1;
      const finalSeg: Transcript = {
        id: crypto.randomUUID(),
        meeting_id: id,
        speaker: speakerRef.current,
        content: interimRef.current.trim(),
        segment_index: segCounterRef.current,
        spoken_at: new Date().toISOString(),
        status: "final"
      };
      setTranscripts(prev => [...prev, finalSeg]);
      await supabase.from("transcripts").insert(finalSeg);
    }
    stopLive();
    
    await supabase.from("meetings").update({
      status: "completed",
      ended_at: new Date().toISOString(),
      duration_seconds: elapsed,
      started_at: m?.started_at ?? new Date(Date.now() - elapsed * 1000).toISOString(),
    }).eq("id", id);

    setSummarizing(true);
    try {
      await summarize({ data: { meetingId: id, screenshots } });
      toast.success("AI summary generated from your transcript and slides.");
    } catch (err: any) {
      toast.error(getFriendlyErrorMessage(err, "Couldn't generate summary."));
    } finally {
      setSummarizing(false);
      await load();
    }
  }

  useEffect(() => () => { stopLive(); }, []);

  const emailDraft = useMemo(() => {
    if (!summary) return "";
    return `Hi team,\n\nHere's a quick recap of "${m?.title}":\n\n${summary.executive_summary}\n\nAction items:\n${actions.map(a => `- ${a.title}${a.assignee ? ` (${a.assignee})` : ""}`).join("\n")}\n\nDecisions:\n${decisions.map(d => `- ${d.description}`).join("\n")}\n\nBest,\nAI Powered Meeting Companion`;
  }, [summary, actions, decisions, m]);

  async function handleGenerateRecaps() {
    setGeneratingRecaps(true);
    try {
      const recaps = await generateRecaps({ data: { meetingId: id } });
      setStudentRecaps(recaps);
      toast.success("Generated individualized recaps for participants.");
    } catch (err: any) {
      toast.error(getFriendlyErrorMessage(err, "Failed to generate recaps."));
    } finally {
      setGeneratingRecaps(false);
    }
  }

  if (!m) return <p className="text-sm text-muted-foreground">Loading…</p>;

  async function updateTranscriptSpeaker(transcriptId: string, newSpeaker: string) {
    setTranscripts(prev => prev.map(t => t.id === transcriptId ? { ...t, speaker: newSpeaker } : t));
    const { error } = await supabase.from("transcripts").update({ speaker: newSpeaker }).eq("id", transcriptId);
    if (error) {
      toast.error("Failed to update speaker");
    }
  }

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
            <>
              {m.meeting_link ? (
                <Button variant="outline" className="glass rounded-full border-white/10" onClick={() => window.open(m.meeting_link!, "_blank")}>
                  Open Link
                </Button>
              ) : (
                <Dialog open={addLinkOpen} onOpenChange={setAddLinkOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" className="glass rounded-full border-white/10 text-orange-200 border-orange-500/30 hover:bg-orange-500/10">
                      Add Meeting Link
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="glass border-white/10">
                    <DialogHeader>
                      <DialogTitle>Add Meeting Link</DialogTitle>
                      <DialogDescription>Paste the link to your meeting so you can join it from here.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 pt-2">
                      <Input value={newLink} onChange={(e) => setNewLink(e.target.value)} placeholder="https://..." className="glass border-white/10" />
                      <Button onClick={async () => {
                        if (!newLink) return;
                        await supabase.from("meetings").update({ meeting_link: newLink }).eq("id", id);
                        toast.success("Link added");
                        setAddLinkOpen(false);
                        load();
                      }} className="w-full gradient-bg rounded-full shadow-glow">Save Link</Button>
                    </div>
                  </DialogContent>
                </Dialog>
              )}
              
              <Button onClick={() => setConsentOpen(true)} className="gradient-bg rounded-full shadow-glow">
                <Video className="mr-2 h-4 w-4" /> Join as AI Assistant
              </Button>
            </>
          )}
          {live && (
            <>
              <Button variant="outline" className="glass rounded-full border-white/10" onClick={() => setPaused(p => !p)}>
                {paused ? <Play className="mr-2 h-4 w-4" /> : <Pause className="mr-2 h-4 w-4" />}
                {paused ? "Resume" : "Pause"}
              </Button>
              <Button variant="destructive" className="rounded-full" onClick={endMeeting} disabled={summarizing}>
                {summarizing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                End meeting
              </Button>
            </>
          )}
          <Button variant="outline" className="glass rounded-full border-white/10" onClick={download}>
            <Download className="mr-2 h-4 w-4" /> Transcript
          </Button>
        </div>
      </header>

      {live && (
        <div className="glass flex items-center gap-3 rounded-2xl p-4 text-sm">
          <Mic className={"h-4 w-4 " + (paused ? "text-muted-foreground" : "text-primary animate-pulse")} />
          <span className="text-muted-foreground shrink-0">{paused ? "Paused" : "Listening…"}</span>
          <span className="truncate italic text-foreground/80">{interim || "Speak now — your words appear here in real time."}</span>
        </div>
      )}

      <Dialog open={consentOpen} onOpenChange={setConsentOpen}>
        <DialogContent className="glass border-white/10 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Video className="h-5 w-5 text-primary" /> Setup AI Assistant</DialogTitle>
            <DialogDescription className="pt-3 text-sm space-y-4 text-left">
              <p className="text-foreground/80">
                To transcribe remote participants and automatically tag their names, the AI needs access to your Google Meet tab.
              </p>
              
              <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 space-y-3">
                <p className="font-semibold text-foreground flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" /> When the browser prompt appears:
                </p>
                <div className="space-y-3 pl-1">
                  <div className="flex items-start gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">1</div>
                    <p className="text-foreground/90 mt-0.5">Select the <strong>Chrome Tab</strong> tab at the very top.</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">2</div>
                    <p className="text-foreground/90 mt-0.5">Click on your active <strong>Google Meet</strong> tab from the list.</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">3</div>
                    <p className="text-foreground/90 mt-0.5">Make sure <strong>Share tab audio</strong> is toggled ON at the bottom.</p>
                  </div>
                </div>
              </div>

              <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
                <p>Audio is transcribed locally and never stored. Please ensure all participants consent to being transcribed.</p>
              </div>

              <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 space-y-3">
                <p className="font-semibold text-foreground flex items-center gap-2">
                  <Mic className="h-4 w-4 text-primary" /> Local Microphone Language
                </p>
                <div className="text-foreground/80 text-xs">
                  Select the language you will be speaking in:
                </div>
                <select 
                  className="w-full bg-background/50 border border-white/10 rounded-lg p-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  value={selectedLanguage}
                  onChange={(e) => setSelectedLanguage(e.target.value)}
                >
                  <option value="en-US">English (US)</option>
                  <option value="en-GB">English (UK)</option>
                  <option value="hi-IN">Hindi</option>
                  <option value="es-ES">Spanish</option>
                  <option value="fr-FR">French</option>
                  <option value="de-DE">German</option>
                  <option value="ja-JP">Japanese</option>
                  <option value="zh-CN">Chinese (Simplified)</option>
                </select>
              </div>

              {!micSupported && (
                <span className="mt-3 block rounded-lg bg-destructive/10 p-3 text-destructive">
                  Live transcription needs Chrome, Edge, or Safari. Your current browser doesn't support it.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-between w-full mt-2">
            <Button variant="ghost" onClick={() => setConsentOpen(false)}>Cancel</Button>
            <Button className="gradient-bg rounded-full shadow-glow" onClick={beginRecording} disabled={!micSupported}>
               Start AI Assistant <ArrowLeft className="ml-2 h-4 w-4 rotate-180" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="glass border-white/10">
          {m.status !== "completed" ? (
            <TabsTrigger value="transcript">Live Transcript</TabsTrigger>
          ) : (
            <>
              <TabsTrigger value="summary">AI Summary</TabsTrigger>
              <TabsTrigger value="actions">Actions & Decisions</TabsTrigger>
              <TabsTrigger value="email">Tasks & Recap</TabsTrigger>
              <TabsTrigger value="transcript">Full Transcript</TabsTrigger>
            </>
          )}
        </TabsList>

        <TabsContent value="transcript">
          <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
            <div ref={scrollRef} className="glass max-h-[60vh] overflow-y-auto rounded-2xl p-6">
              {transcripts.length === 0 && <p className="text-sm text-muted-foreground">No transcript yet. Click <b>Join as AI Assistant</b>, give consent, and start speaking — your words appear here live.</p>}
              <div className="space-y-3">
                {transcripts.map((t) => (
                  <div key={t.id} className="glass rounded-xl p-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <DropdownMenu>
                        <DropdownMenuTrigger className="font-medium text-foreground hover:underline focus:outline-none cursor-pointer flex items-center gap-1">
                          {t.speaker}
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onClick={() => updateTranscriptSpeaker(t.id, speakerRef.current)}>
                            {speakerRef.current} (Host)
                          </DropdownMenuItem>
                          {participants.map(p => (
                            <DropdownMenuItem key={p.id} onClick={() => updateTranscriptSpeaker(t.id, p.name)}>
                              {p.name}
                            </DropdownMenuItem>
                          ))}
                          <DropdownMenuItem onClick={() => updateTranscriptSpeaker(t.id, "Guest")}>
                            Guest
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => updateTranscriptSpeaker(t.id, "Remote")}>
                            Remote
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <span>{new Date(t.spoken_at).toLocaleTimeString()}</span>
                    </div>
                    <div className="mt-1 text-sm whitespace-pre-wrap">{t.content}</div>
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
            <div className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground flex flex-col items-center justify-center">
              {summarizing ? (
                <><Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin text-primary" />Generating AI summary from your transcript…</>
              ) : m.status === "completed" ? (
                <div className="space-y-3">
                  <p>Summary generation was interrupted due to API limits or network issues.</p>
                  <Button variant="outline" size="sm" onClick={async () => {
                    setSummarizing(true);
                    try {
                      await summarize({ data: { meetingId: id, screenshots } });
                      toast.success("AI summary generated.");
                    } catch (err: any) {
                      toast.error(getFriendlyErrorMessage(err, "Couldn't generate summary."));
                    } finally {
                      setSummarizing(false);
                      await load();
                    }
                  }}>
                    Retry Summary Generation
                  </Button>
                </div>
              ) : (
                "Summary will appear here once the meeting ends."
              )}
            </div>
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
          <div className="space-y-6">
            <div className="glass rounded-2xl p-6">
              <div className="mb-3 flex items-center gap-2"><Mail className="h-4 w-4 text-primary" /><h3 className="font-semibold">General Recap Email</h3></div>
              <pre className="glass whitespace-pre-wrap rounded-xl p-4 text-sm">{emailDraft || "Summary required first."}</pre>
              <div className="mt-4 flex gap-2">
                <Button className="gradient-bg rounded-full shadow-glow" onClick={() => toast.success("Opening Gmail…")}>
                  <Mail className="mr-2 h-4 w-4" /> Send via Gmail
                </Button>
                <Button variant="outline" className="glass rounded-full border-white/10" onClick={() => { navigator.clipboard.writeText(emailDraft); toast.success("Copied to clipboard"); }}>Copy</Button>
              </div>
            </div>

            <div className="glass rounded-2xl p-6">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold">Individual Student/Participant Tasks</h3>
                </div>
                <Button onClick={handleGenerateRecaps} disabled={generatingRecaps || !summary} size="sm" className="gradient-bg rounded-full shadow-glow">
                  {generatingRecaps ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  Generate Individual Recaps
                </Button>
              </div>
              <p className="mb-4 text-sm text-muted-foreground">Generates a customized message for each participant highlighting exactly what they need to do.</p>
              
              {studentRecaps.length > 0 && (
                <div className="space-y-4">
                  {studentRecaps.map((r, i) => (
                    <div key={i} className="glass rounded-xl p-4">
                      <div className="mb-2 font-medium">{r.participantName} {r.email && <span className="text-muted-foreground text-xs">({r.email})</span>}</div>
                      <pre className="whitespace-pre-wrap text-sm text-muted-foreground bg-black/20 p-3 rounded-lg">{r.body}</pre>
                      <div className="mt-3 flex gap-2">
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="glass rounded-full border-white/10" 
                          onClick={() => {
                            const mailto = `mailto:${r.email || ''}?subject=${encodeURIComponent(r.subject)}&body=${encodeURIComponent(r.body)}`;
                            window.location.href = mailto;
                          }}
                        >
                          <Mail className="mr-2 h-3 w-3" /> Email directly
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="glass rounded-full border-white/10" 
                          onClick={() => { navigator.clipboard.writeText(r.body); toast.success("Copied for Google Classroom"); }}
                        >
                          <Users className="mr-2 h-3 w-3" /> Copy for Classroom
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* previous-meeting memory */}
      <section className="glass rounded-2xl p-6">
        <div className="mb-2 flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><h3 className="font-semibold">Meeting memory</h3></div>
        <p className="text-sm text-muted-foreground">AI Powered Meeting Companion remembers prior meetings, pending tasks and previous decisions to brief you before every call. <Link to="/chat" className="text-primary">Ask AI →</Link></p>
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
