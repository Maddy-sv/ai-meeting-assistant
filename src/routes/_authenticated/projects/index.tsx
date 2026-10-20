import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FolderKanban, Plus, ArrowRight, Layers, LayoutGrid } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/projects/")({
  head: () => ({ meta: [{ title: "Projects — AI Powered Meeting Companion" }] }),
  component: ProjectsPage,
});

type Project = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
};

function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    if (u.user) {
      const { data } = await supabase
        .from("projects")
        .select("*")
        .eq("owner_id", u.user.id)
        .order("created_at", { ascending: false });
      setProjects((data as Project[]) || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("projects").insert({
        name: name.trim(),
        description: description.trim() || null,
        owner_id: u.user?.id,
      });
      if (error) throw error;
      toast.success("Project created!");
      setCreateOpen(false);
      setName("");
      setDescription("");
      load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <p className="p-8 text-muted-foreground">Loading projects...</p>;

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight flex items-center gap-2">
            <FolderKanban className="text-primary" /> Projects
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Group related meetings to generate cumulative AI insights.
          </p>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gradient-bg rounded-full shadow-glow">
              <Plus className="mr-2 h-4 w-4" /> New Project
            </Button>
          </DialogTrigger>
          <DialogContent className="glass border-white/10 sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Create Project</DialogTitle>
              <DialogDescription>Group your recurring meetings together.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4 pt-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase text-muted-foreground">
                  Project Name
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Marketing Q3"
                  required
                  className="bg-black/20 border-white/10"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase text-muted-foreground">
                  Description (Optional)
                </label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Weekly team syncs..."
                  className="bg-black/20 border-white/10"
                />
              </div>
              <Button
                disabled={creating || !name.trim()}
                className="w-full gradient-bg rounded-full shadow-glow"
              >
                {creating ? "Creating..." : "Create Project"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </header>

      {projects.length === 0 ? (
        <div className="glass mx-auto max-w-lg rounded-3xl p-12 text-center mt-12">
          <Layers className="mx-auto mb-4 h-12 w-12 text-primary opacity-50" />
          <h2 className="text-xl font-bold">No projects yet</h2>
          <p className="mt-2 text-sm text-muted-foreground mb-6">
            Create your first project to start grouping meetings and unlocking cumulative AI
            summaries.
          </p>
          <Button
            onClick={() => setCreateOpen(true)}
            className="gradient-bg rounded-full shadow-glow"
          >
            <Plus className="mr-2 h-4 w-4" /> Create First Project
          </Button>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link
              key={p.id}
              to={`/projects/$id`}
              params={{ id: p.id }}
              className="glass group rounded-2xl p-6 transition-all hover:scale-[1.02] hover:bg-white/5 border border-white/5 hover:border-primary/50 relative overflow-hidden"
            >
              <div className="absolute -right-4 -top-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <FolderKanban className="w-24 h-24" />
              </div>
              <h3 className="font-bold text-lg mb-2 relative z-10">{p.name}</h3>
              {p.description && (
                <p className="text-sm text-muted-foreground mb-6 relative z-10 line-clamp-2">
                  {p.description}
                </p>
              )}

              <div className="mt-6 flex items-center justify-between text-xs text-muted-foreground relative z-10 font-medium group-hover:text-primary transition-colors">
                <span>View Details</span>
                <ArrowRight className="h-4 w-4 transform group-hover:translate-x-1 transition-transform" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
