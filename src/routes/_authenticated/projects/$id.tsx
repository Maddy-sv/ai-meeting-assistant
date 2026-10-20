import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowLeft,
  CalendarPlus,
  FolderKanban,
  Loader2,
  Pencil,
  Sparkles,
  Trash2,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Section,
  StatusBadge,
} from "@/components/layout";
import { ProjectFormDialog } from "@/components/projects/project-form-dialog";
import { ProjectSummaryReportView } from "@/components/projects/project-summary-report";
import { ScheduleMeetingDialog } from "@/components/schedule/schedule-meeting-dialog";
import { generateProjectSummary, type ProjectSummaryReport } from "@/lib/ai.functions";
import { platformLabel } from "@/lib/format";
import { dataKeys, deleteProject, getProject, listProjectMeetings, updateProject } from "@/lib/rpc";

export const Route = createFileRoute("/_authenticated/projects/$id")({
  head: () => ({ meta: [{ title: "Project — AI Powered Meeting Companion" }] }),
  component: ProjectPage,
});

function ProjectPage() {
  const { id } = Route.useParams();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [summary, setSummary] = useState<ProjectSummaryReport | null>(null);

  const project = useQuery({ queryKey: dataKeys.project(id), queryFn: () => getProject(id) });
  const meetings = useQuery({
    queryKey: dataKeys.projectMeetings(id),
    queryFn: () => listProjectMeetings(id),
  });

  async function save(values: { name: string; description: string | null }) {
    await updateProject(id, values);
    toast.success("Project saved.");
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: dataKeys.project(id) }),
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
    ]);
  }

  async function remove() {
    await deleteProject(id);
    toast.success("Project deleted. Its meetings were kept.");
    queryClient.removeQueries({ queryKey: dataKeys.project(id) });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      queryClient.invalidateQueries({ queryKey: ["meetings"] }),
    ]);
    navigate({ to: "/projects" });
  }

  async function generate() {
    setGenerating(true);
    try {
      const result = await generateProjectSummary({ data: { projectId: id } });
      setSummary(result);
      toast.success(
        result.ai_enhanced ? "Project summary ready." : "Project summary built from saved records.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate the summary.");
    } finally {
      setGenerating(false);
    }
  }

  const backLink = (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link to="/projects">
        <ArrowLeft /> All projects
      </Link>
    </Button>
  );

  if (project.isLoading) {
    return (
      <div className="space-y-6">
        {backLink}
        <LoadingState variant="list" rows={3} label="Loading project…" />
      </div>
    );
  }
  if (project.isError) {
    return (
      <div className="space-y-6">
        {backLink}
        <ErrorState message={project.error.message} onRetry={() => project.refetch()} />
      </div>
    );
  }
  if (!project.data) {
    return (
      <div className="space-y-6">
        {backLink}
        <EmptyState
          icon={FolderKanban}
          title="Project not found"
          description="It may have been deleted, or it belongs to someone else."
          action={
            <Button asChild variant="brand">
              <Link to="/projects">Back to projects</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const p = project.data;
  const meetingCount = meetings.data?.length ?? 0;

  return (
    <div className="space-y-8">
      {backLink}
      <PageHeader
        eyebrow="Project"
        title={p.name}
        description={p.description || "No description yet."}
        actions={
          <>
            <Button variant="glass" onClick={() => setEditOpen(true)}>
              <Pencil /> Edit
            </Button>
            <ConfirmDialog
              title={`Delete "${p.name}"?`}
              description="The project is removed, but its meetings are kept. They just won't belong to a project any more."
              confirmLabel="Delete project"
              destructive
              onConfirm={remove}
              trigger={
                <Button variant="ghost" className="text-destructive hover:text-destructive">
                  <Trash2 /> Delete
                </Button>
              }
            />
          </>
        }
      />

      <ProjectFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        initialValues={{ name: p.name, description: p.description }}
        onSubmit={save}
      />
      <ScheduleMeetingDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        defaultProjectId={id}
        title={`New meeting in ${p.name}`}
      />

      <Section
        card
        title="Project summary"
        description="A detailed report built only from this project's saved meetings, summaries, decisions and tasks."
        actions={
          <Button
            variant="brand"
            onClick={generate}
            disabled={generating || meetingCount === 0}
            aria-describedby={meetingCount === 0 ? "summary-hint" : undefined}
          >
            {generating ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {generating ? "Generating…" : summary ? "Regenerate" : "Generate summary"}
          </Button>
        }
      >
        {meetingCount === 0 && (
          <p id="summary-hint" className="text-sm text-muted-foreground">
            Add at least one meeting to this project to generate a summary.
          </p>
        )}
        {meetingCount > 0 && !summary && !generating && (
          <p className="text-sm text-muted-foreground">
            Generate a summary to see progress across all {meetingCount} meeting
            {meetingCount === 1 ? "" : "s"}.
          </p>
        )}
        {generating && !summary && (
          <LoadingState variant="list" rows={2} label="Generating summary…" />
        )}
        {summary && (
          <div className={generating ? "opacity-60" : undefined} aria-busy={generating}>
            <ProjectSummaryReportView report={summary} />
          </div>
        )}
      </Section>

      <Section
        title={`Meetings${meetings.data ? ` (${meetingCount})` : ""}`}
        actions={
          <Button variant="glass" size="sm" onClick={() => setScheduleOpen(true)}>
            <CalendarPlus /> Add meeting
          </Button>
        }
      >
        {meetings.isLoading && <LoadingState variant="list" rows={3} label="Loading meetings…" />}
        {meetings.isError && (
          <ErrorState message={meetings.error.message} onRetry={() => meetings.refetch()} />
        )}
        {meetings.data && meetingCount === 0 && (
          <EmptyState
            icon={Video}
            title="No meetings in this project"
            description="Schedule a meeting here, or pick this project when creating a meeting."
            action={
              <Button variant="brand" onClick={() => setScheduleOpen(true)}>
                <CalendarPlus /> Add meeting
              </Button>
            }
          />
        )}
        {meetings.data && meetingCount > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {meetings.data.map((m) => {
              const when = m.started_at ?? m.scheduled_at;
              return (
                <li key={m.id}>
                  <Link
                    to="/meetings/$id"
                    params={{ id: m.id }}
                    className="glass flex h-full flex-col gap-2 rounded-2xl p-4 transition hover:shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate font-semibold">{m.title}</span>
                      <StatusBadge kind="meeting" status={m.status} />
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {platformLabel(m.platform)}
                      {when ? ` · ${format(new Date(when), "d MMM yyyy, HH:mm")}` : ""}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
