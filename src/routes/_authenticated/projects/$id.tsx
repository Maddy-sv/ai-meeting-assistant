import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { FolderKanban, ArrowLeft, Video, Calendar, Sparkles, Loader2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { generateProjectSummary as genSummaryFn } from "@/lib/ai.functions";

export const Route = createFileRoute("/_authenticated/projects/$id")({
  head: () => ({ meta: [{ title: "Project Dashboard — AI Powered Meeting Companion" }] }),
  component: ProjectDashboard,
});

type Project = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
};

type Meeting = {
  id: string;
  title: string;
  scheduled_at: string;
  platform: string;
  status: string;
};

function ProjectDashboard() {
  const { id } = Route.useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [cumulativeSummary, setCumulativeSummary] = useState<any>(null);

  async function load() {
    setLoading(true);
    const { data: p } = await supabase.from("projects").select("*").eq("id", id).single();
    if (p) setProject(p as Project);

    const { data: m } = await supabase
      .from("meetings")
      .select("*")
      .eq("project_id", id)
      .order("scheduled_at", { ascending: false });
    
    setMeetings((m as Meeting[]) || []);
    
    // Check if there is an existing cumulative summary (for now we don't save it to DB, we just generate it on the fly, or we could save it to a new table `project_summaries`. Let's just generate on fly for now)
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [id]);

  async function generateCumulativeSummary() {
    if (meetings.length === 0) {
      toast.error("Add some meetings to this project first!");
      return;
    }
    
    setGenerating(true);
    try {
      // Call the server function
      const data = await genSummaryFn({ data: { projectId: id } });
      
      setCumulativeSummary(data);
      toast.success("Cumulative summary generated!");
    } catch (err: any) {
      toast.error(err.message || "Failed to generate summary");
    } finally {
      setGenerating(false);
    }
  }

  if (loading) return <p className="p-8 text-muted-foreground">Loading project...</p>;
  if (!project) return <p className="p-8 text-red-400">Project not found.</p>;

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <Link to="/projects" className="inline-flex items-center text-sm text-muted-foreground hover:text-white transition-colors">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to Projects
      </Link>

      <header className="glass p-8 rounded-3xl relative overflow-hidden border border-white/10">
        <div className="absolute right-0 top-0 opacity-10 pointer-events-none">
          <FolderKanban className="w-64 h-64 -mt-10 -mr-10 text-primary" />
        </div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <h1 className="text-4xl font-black tracking-tight mb-2">{project.name}</h1>
            <p className="text-muted-foreground text-lg">{project.description || "No description provided."}</p>
          </div>
          <Button 
            onClick={generateCumulativeSummary} 
            disabled={generating || meetings.length === 0}
            className="gradient-bg rounded-full shadow-glow shrink-0 text-md px-6 py-6"
          >
            {generating ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-5 w-5" />
            )}
            {generating ? "Analyzing Project History..." : "Generate Cumulative Summary"}
          </Button>
        </div>
      </header>

      {cumulativeSummary && (
        <section className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="text-primary" /> AI Project Analysis
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="glass p-6 rounded-2xl border border-primary/20">
              <h3 className="text-lg font-bold mb-4 text-primary">Cumulative Progress</h3>
              <div className="prose prose-invert max-w-none text-sm text-muted-foreground whitespace-pre-line">
                {cumulativeSummary.progress_report}
              </div>
            </div>
            <div className="glass p-6 rounded-2xl border border-amber-500/20">
              <h3 className="text-lg font-bold mb-4 text-amber-500">Suggested Agenda for Next Meeting</h3>
              <ul className="space-y-3">
                {cumulativeSummary.suggested_agenda?.map((item: string, i: number) => (
                  <li key={i} className="flex gap-3 text-sm text-muted-foreground">
                    <div className="h-6 w-6 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0 font-bold text-xs">
                      {i + 1}
                    </div>
                    <span className="mt-0.5">{item}</span>
                  </li>
                ))}
                {(!cumulativeSummary.suggested_agenda || cumulativeSummary.suggested_agenda.length === 0) && (
                  <p className="text-sm text-muted-foreground">No specific agenda items suggested.</p>
                )}
              </ul>
            </div>
          </div>
        </section>
      )}

      <section className="space-y-4">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Video className="text-muted-foreground" /> Project Meetings ({meetings.length})
        </h2>
        
        {meetings.length === 0 ? (
          <div className="glass rounded-2xl p-8 text-center border-dashed border-2 border-white/10">
            <p className="text-muted-foreground">No meetings assigned to this project yet.</p>
            <p className="text-xs text-muted-foreground mt-2">When scheduling a new meeting, select this project to link them.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {meetings.map((m) => (
              <Link key={m.id} to={`/meetings/$id`} params={{ id: m.id }} className="glass group rounded-2xl p-5 transition-all hover:scale-[1.02] hover:bg-white/5">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  <Calendar className="h-4 w-4" />
                  {new Date(m.scheduled_at).toLocaleDateString()}
                </div>
                <h3 className="font-bold text-lg mb-1 truncate">{m.title}</h3>
                <div className="flex items-center justify-between mt-4">
                  <span className="text-xs font-medium px-2 py-1 rounded bg-white/5 capitalize text-muted-foreground">
                    {m.status}
                  </span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-white transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
