import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { CheckCircle2, Search, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
  normalizeMeetingStatus,
  statusLabel,
} from "@/components/layout";
import { adminListMeetings } from "@/lib/rpc";

export const Route = createFileRoute("/_authenticated/admin/meetings")({
  head: () => ({ meta: [{ title: "Meetings — Admin — AI Meeting Companion" }] }),
  component: AdminMeetings,
});

const ALL = "all";

function AdminMeetings() {
  const meetings = useQuery({ queryKey: ["admin", "meetings"], queryFn: adminListMeetings });
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>(ALL);

  const statuses = useMemo(
    () =>
      Array.from(
        new Set((meetings.data ?? []).map((m) => normalizeMeetingStatus(m.status))),
      ).sort(),
    [meetings.data],
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (meetings.data ?? []).filter((m) => {
      if (status !== ALL && normalizeMeetingStatus(m.status) !== status) return false;
      if (!term) return true;
      return (
        m.title.toLowerCase().includes(term) ||
        (m.host_name ?? "").toLowerCase().includes(term) ||
        (m.host_email ?? "").toLowerCase().includes(term)
      );
    });
  }, [meetings.data, q, status]);

  const filtering = q.trim() !== "" || status !== ALL;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Administration"
        title="Meetings"
        description="Every meeting across all workspaces."
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:max-w-sm">
          <label htmlFor="meeting-search" className="sr-only">
            Search meetings by title or host
          </label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="meeting-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by title or host…"
            className="glass rounded-full pl-9"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="glass w-44 rounded-full" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>
                {statusLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtering && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ("");
              setStatus(ALL);
            }}
          >
            Clear filters
          </Button>
        )}
        {meetings.data && (
          <span className="text-sm text-muted-foreground">
            {filtered.length} of {meetings.data.length} meetings
          </span>
        )}
      </div>

      {meetings.isLoading && <LoadingState variant="table" rows={6} label="Loading meetings…" />}
      {meetings.isError && (
        <ErrorState message={meetings.error.message} onRetry={() => meetings.refetch()} />
      )}
      {meetings.data && filtered.length === 0 && (
        <EmptyState
          icon={Video}
          title={filtering ? "No meetings match these filters" : "No meetings yet"}
        />
      )}

      {filtered.length > 0 && (
        <div className="glass overflow-x-auto rounded-2xl">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead>Meeting</TableHead>
                <TableHead>Host</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Scheduled</TableHead>
                <TableHead className="text-right">Transcript lines</TableHead>
                <TableHead>Summary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((m) => (
                <TableRow key={m.id} className="border-border">
                  <TableCell className="min-w-48">
                    <Link
                      to="/meetings/$id"
                      params={{ id: m.id }}
                      className="font-medium hover:underline"
                    >
                      {m.title}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      Created {format(new Date(m.created_at), "d MMM yyyy")}
                    </div>
                  </TableCell>
                  <TableCell className="min-w-40">
                    <div>{m.host_name || "Unnamed user"}</div>
                    <div className="text-xs text-muted-foreground">{m.host_email}</div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge kind="meeting" status={m.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {m.scheduled_at
                      ? format(new Date(m.scheduled_at), "d MMM yyyy, HH:mm")
                      : "Not scheduled"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{m.transcript_count}</TableCell>
                  <TableCell>
                    {m.has_summary ? (
                      <span className="inline-flex items-center gap-1 text-sm text-success">
                        <CheckCircle2 className="h-4 w-4" /> Ready
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">None</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
