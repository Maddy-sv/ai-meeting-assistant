import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowRight, FolderKanban, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/layout";
import { ProjectFormDialog } from "@/components/projects/project-form-dialog";
import { useUser } from "@/lib/auth";
import { createProject, dataKeys, listMyMeetings, listProjects } from "@/lib/rpc";

export const Route = createFileRoute("/_authenticated/projects/")({
  head: () => ({ meta: [{ title: "Projects — AI Powered Meeting Companion" }] }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const user = useUser();
  const userId = user?.id ?? "";
  const queryClient = useQueryClient();
  const navigate = Route.useNavigate();
  const [createOpen, setCreateOpen] = useState(false);

  const projects = useQuery({
    queryKey: dataKeys.projects(userId),
    queryFn: () => listProjects(userId),
    enabled: !!user,
  });
  // Used only for per-project meeting counts; the list still renders if it fails.
  const meetings = useQuery({
    queryKey: dataKeys.myMeetings(userId),
    queryFn: () => listMyMeetings(userId),
    enabled: !!user,
  });

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of meetings.data ?? []) {
      if (m.project_id) map.set(m.project_id, (map.get(m.project_id) ?? 0) + 1);
    }
    return map;
  }, [meetings.data]);

  async function create(values: { name: string; description: string | null }) {
    if (!user) throw new Error("Your session has expired. Please sign in again.");
    const project = await createProject({ ownerId: user.id, ...values });
    toast.success(`Project "${project.name}" created.`);
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
    navigate({ to: "/projects/$id", params: { id: project.id } });
  }

  const newButton = (
    <Button variant="brand" onClick={() => setCreateOpen(true)}>
      <Plus /> New project
    </Button>
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Projects"
        description="Group related meetings and get a cumulative summary across them."
        actions={newButton}
      />

      <ProjectFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        onSubmit={create}
      />

      {projects.isLoading && <LoadingState variant="cards" rows={3} label="Loading projects…" />}
      {projects.isError && (
        <ErrorState message={projects.error.message} onRetry={() => projects.refetch()} />
      )}
      {projects.data && projects.data.length === 0 && (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="Create a project, then pick it when you schedule meetings to link them together."
          action={newButton}
        />
      )}
      {projects.data && projects.data.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.data.map((p) => {
            const count = counts.get(p.id);
            return (
              <li key={p.id}>
                <Link
                  to="/projects/$id"
                  params={{ id: p.id }}
                  className="glass group flex h-full flex-col rounded-2xl p-5 transition hover:shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-start gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
                      <FolderKanban className="h-5 w-5" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold">{p.name}</h2>
                      <p className="text-xs text-muted-foreground">
                        Created {format(new Date(p.created_at), "d MMM yyyy")}
                      </p>
                    </div>
                  </div>
                  {p.description && (
                    <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                      {p.description}
                    </p>
                  )}
                  <div className="mt-auto flex items-center justify-between pt-4 text-xs text-muted-foreground">
                    <span>
                      {count === undefined
                        ? meetings.isSuccess
                          ? "No meetings yet"
                          : ""
                        : `${count} meeting${count === 1 ? "" : "s"}`}
                    </span>
                    <ArrowRight
                      className="h-4 w-4 transition group-hover:translate-x-1 group-hover:text-primary"
                      aria-hidden
                    />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
