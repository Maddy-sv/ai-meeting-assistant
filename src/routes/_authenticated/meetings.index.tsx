import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { FolderKanban, Plus, Search, Trash2, Video, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Section,
  StatusBadge,
} from "@/components/layout";
import { ScheduleMeetingDialog } from "@/components/schedule/schedule-meeting-dialog";
import { useUser } from "@/lib/auth";
import { formatDuration, platformLabel } from "@/lib/format";
import { dataKeys, listMyMeetings, listProjects, type MeetingListRow } from "@/lib/rpc";
import { normalizeMeetingStatus } from "@/components/layout/status";

type StatusFilter = "all" | "upcoming" | "live" | "completed";

const STATUS_FILTER_VALUES: StatusFilter[] = ["all", "upcoming", "live", "completed"];

export const Route = createFileRoute("/_authenticated/meetings/")({
  validateSearch: (search: Record<string, unknown>): { status?: StatusFilter } => ({
    status: STATUS_FILTER_VALUES.find((v) => v === search.status),
  }),
  head: () => ({ meta: [{ title: "My Meetings — AI Powered Meeting Companion" }] }),
  component: MeetingsList,
});

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "upcoming", label: "Upcoming" },
  { value: "live", label: "Live" },
  { value: "completed", label: "Completed" },
];

async function deleteMeetings(ids: string[]) {
  const { data, error } = await supabase.from("meetings").delete().in("id", ids).select("id");
  if (error) {
    console.error("[meetings] delete failed", error);
    throw new Error(
      ids.length === 1 ? "Could not delete the meeting." : "Could not delete the meetings.",
    );
  }
  if ((data?.length ?? 0) < ids.length) {
    throw new Error("Some meetings could not be deleted. You can only delete meetings you host.");
  }
}

function meetingTime(m: MeetingListRow) {
  return m.started_at ?? m.scheduled_at ?? m.created_at;
}

function MeetingsList() {
  const user = useUser();
  const userId = user?.id ?? "";
  const queryClient = useQueryClient();
  const initialStatus = Route.useSearch().status ?? "all";

  const meetings = useQuery({
    queryKey: dataKeys.myMeetings(userId),
    queryFn: () => listMyMeetings(userId),
    enabled: !!user,
  });
  const projects = useQuery({
    queryKey: dataKeys.projects(userId),
    queryFn: () => listProjects(userId),
    enabled: !!user,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>(initialStatus);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const projectNames = useMemo(
    () => new Map((projects.data ?? []).map((p) => [p.id, p.name])),
    [projects.data],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (meetings.data ?? []).filter((m) => {
      if (status !== "all" && normalizeMeetingStatus(m.status) !== status) return false;
      if (!term) return true;
      const project = m.project_id ? (projectNames.get(m.project_id) ?? "") : "";
      return m.title.toLowerCase().includes(term) || project.toLowerCase().includes(term);
    });
  }, [meetings.data, search, status, projectNames]);

  const active = filtered
    .filter((m) => normalizeMeetingStatus(m.status) !== "completed")
    .sort((a, b) => {
      if (
        normalizeMeetingStatus(a.status) === "live" &&
        normalizeMeetingStatus(b.status) !== "live"
      )
        return -1;
      if (
        normalizeMeetingStatus(b.status) === "live" &&
        normalizeMeetingStatus(a.status) !== "live"
      )
        return 1;
      return meetingTime(a).localeCompare(meetingTime(b));
    });
  const past = filtered
    .filter((m) => normalizeMeetingStatus(m.status) === "completed")
    .sort((a, b) => meetingTime(b).localeCompare(meetingTime(a)));

  const visibleIds = new Set(filtered.map((m) => m.id));
  const selectedVisible = [...selected].filter((id) => visibleIds.has(id));
  const allVisibleSelected = filtered.length > 0 && selectedVisible.length === filtered.length;

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(filtered.map((m) => m.id)) : new Set());
  }

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["meetings"] }),
      queryClient.invalidateQueries({ queryKey: ["project"] }),
      queryClient.invalidateQueries({ queryKey: ["user-dashboard"] }),
    ]);
  }

  async function removeOne(m: MeetingListRow) {
    await deleteMeetings([m.id]);
    toast.success(`Deleted "${m.title}".`);
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(m.id);
      return next;
    });
    await refresh();
  }

  async function removeSelected() {
    const ids = selectedVisible;
    await deleteMeetings(ids);
    toast.success(`Deleted ${ids.length} meeting${ids.length === 1 ? "" : "s"}.`);
    setSelected(new Set());
    await refresh();
  }

  const total = meetings.data?.length ?? 0;
  const filtersActive = search.trim() !== "" || status !== "all";

  return (
    <div className="space-y-8">
      <PageHeader
        title="My Meetings"
        description="Schedule meetings, open past ones and review their summaries."
        actions={
          <Button variant="brand" onClick={() => setCreateOpen(true)}>
            <Plus /> New meeting
          </Button>
        }
      />

      <ScheduleMeetingDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New meeting"
        allowStartNow
      />

      {meetings.isLoading && <LoadingState variant="list" rows={5} label="Loading meetings…" />}

      {meetings.isError && (
        <ErrorState message={meetings.error.message} onRetry={() => meetings.refetch()} />
      )}

      {meetings.data && total === 0 && (
        <EmptyState
          icon={Video}
          title="No meetings yet"
          description="Create your first meeting to start capturing transcripts, summaries and action items."
          action={
            <Button variant="brand" onClick={() => setCreateOpen(true)}>
              <Plus /> New meeting
            </Button>
          }
        />
      )}

      {meetings.data && total > 0 && (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="meeting-search">Search meetings</Label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="meeting-search"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Title or project…"
                  className="pl-9"
                />
              </div>
            </div>
            <div className="space-y-1.5 sm:w-48">
              <Label htmlFor="meeting-status">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
                <SelectTrigger id="meeting-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_FILTERS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {filtered.length > 0 && (
            <div className="glass flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="select-all-meetings"
                  checked={
                    allVisibleSelected ? true : selectedVisible.length > 0 ? "indeterminate" : false
                  }
                  onCheckedChange={(c) => toggleAll(c === true)}
                />
                <Label htmlFor="select-all-meetings" className="cursor-pointer text-sm">
                  {selectedVisible.length > 0
                    ? `${selectedVisible.length} selected`
                    : `Select all (${filtered.length})`}
                </Label>
              </div>
              {selectedVisible.length > 0 && (
                <div className="ml-auto flex flex-wrap gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                    <X /> Clear
                  </Button>
                  <ConfirmDialog
                    title={`Delete ${selectedVisible.length} meeting${selectedVisible.length === 1 ? "" : "s"}?`}
                    description="Their transcripts, summaries, action items and decisions will be deleted too. This cannot be undone."
                    confirmLabel="Delete"
                    destructive
                    onConfirm={removeSelected}
                    trigger={
                      <Button variant="destructive" size="sm" className="rounded-full">
                        <Trash2 /> Delete selected
                      </Button>
                    }
                  />
                </div>
              )}
            </div>
          )}

          {filtered.length === 0 && (
            <EmptyState
              icon={Search}
              title="No meetings match"
              description="Try a different search term or status."
              action={
                filtersActive && (
                  <Button
                    variant="glass"
                    onClick={() => {
                      setSearch("");
                      setStatus("all");
                    }}
                  >
                    Clear filters
                  </Button>
                )
              }
            />
          )}

          {active.length > 0 && (
            <Section title="Upcoming & live">
              <MeetingList
                meetings={active}
                projectNames={projectNames}
                selected={selected}
                onToggle={toggle}
                onDelete={removeOne}
              />
            </Section>
          )}

          {past.length > 0 && (
            <Section title="Past meetings">
              <MeetingList
                meetings={past}
                projectNames={projectNames}
                selected={selected}
                onToggle={toggle}
                onDelete={removeOne}
              />
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function MeetingList({
  meetings,
  projectNames,
  selected,
  onToggle,
  onDelete,
}: {
  meetings: MeetingListRow[];
  projectNames: Map<string, string>;
  selected: Set<string>;
  onToggle: (id: string, checked: boolean) => void;
  onDelete: (m: MeetingListRow) => Promise<void>;
}) {
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {meetings.map((m) => (
        <MeetingRow
          key={m.id}
          meeting={m}
          projectName={m.project_id ? projectNames.get(m.project_id) : undefined}
          selected={selected.has(m.id)}
          onToggle={onToggle}
          onDelete={onDelete}
        />
      ))}
    </ul>
  );
}

function MeetingRow({
  meeting: m,
  projectName,
  selected,
  onToggle,
  onDelete,
}: {
  meeting: MeetingListRow;
  projectName?: string;
  selected: boolean;
  onToggle: (id: string, checked: boolean) => void;
  onDelete: (m: MeetingListRow) => Promise<void>;
}) {
  const when = m.started_at ?? m.scheduled_at;
  const checkboxId = `select-meeting-${m.id}`;
  return (
    <li
      className={`glass group flex items-start gap-3 rounded-2xl p-4 transition hover:shadow-glow focus-within:shadow-glow ${
        selected ? "ring-2 ring-primary/60" : ""
      }`}
    >
      <Checkbox
        id={checkboxId}
        checked={selected}
        onCheckedChange={(c) => onToggle(m.id, c === true)}
        aria-label={`Select ${m.title}`}
        className="mt-1"
      />
      <Link
        to="/meetings/$id"
        params={{ id: m.id }}
        className="min-w-0 flex-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-semibold">{m.title}</span>
          <StatusBadge kind="meeting" status={m.status} />
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {platformLabel(m.platform)}
          {when && ` · ${format(new Date(when), "EEE d MMM yyyy, HH:mm")}`}
          {m.duration_seconds ? ` · ${formatDuration(m.duration_seconds)}` : ""}
        </div>
        {projectName && (
          <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
            <FolderKanban className="h-3 w-3" aria-hidden />
            {projectName}
          </div>
        )}
      </Link>
      <ConfirmDialog
        title={`Delete "${m.title}"?`}
        description="Its transcript, summary, action items and decisions will be deleted too. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={() => onDelete(m)}
        trigger={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${m.title}`}
            className="shrink-0 rounded-full text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 sm:opacity-0"
          >
            <Trash2 />
          </Button>
        }
      />
    </li>
  );
}
