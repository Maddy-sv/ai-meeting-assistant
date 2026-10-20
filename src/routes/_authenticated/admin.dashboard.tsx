import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  ListChecks,
  Sparkles,
  UserCheck,
  Users,
  Video,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Section,
  StatTile,
  StatusBadge,
} from "@/components/layout";
import { adminListMeetings, adminListUsers, adminOverview } from "@/lib/rpc";

export const Route = createFileRoute("/_authenticated/admin/dashboard")({
  head: () => ({ meta: [{ title: "Admin overview — AI Meeting Companion" }] }),
  component: AdminDashboard,
});

function AdminDashboard() {
  const overview = useQuery({ queryKey: ["admin", "overview"], queryFn: adminOverview });
  const users = useQuery({ queryKey: ["admin", "users"], queryFn: adminListUsers });
  const meetings = useQuery({ queryKey: ["admin", "meetings"], queryFn: adminListMeetings });

  const o = overview.data;
  const recentUsers = [...(users.data ?? [])]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 5);
  const recentMeetings = [...(meetings.data ?? [])]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 5);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Administration"
        title="Admin overview"
        description="Live totals across every workspace."
      />

      {overview.isError ? (
        <ErrorState message={overview.error.message} onRetry={() => overview.refetch()} />
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile
            label="Users"
            icon={Users}
            loading={overview.isLoading}
            value={o?.users ?? 0}
            hint={o ? `${o.active_users_7d} active in the last 7 days` : undefined}
          />
          <StatTile
            label="Meetings"
            icon={Video}
            loading={overview.isLoading}
            value={o?.meetings ?? 0}
            hint={o ? `${o.meetings_completed} completed` : undefined}
          />
          <StatTile
            label="Transcripts"
            icon={FileText}
            loading={overview.isLoading}
            value={o?.transcripts ?? 0}
          />
          <StatTile
            label="Summaries"
            icon={Sparkles}
            loading={overview.isLoading}
            value={o?.summaries ?? 0}
          />
          <StatTile
            label="Action items"
            icon={ListChecks}
            loading={overview.isLoading}
            value={o?.action_items ?? 0}
          />
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Section
          title="Newest users"
          actions={
            <Button asChild variant="glass" size="sm">
              <Link to="/admin/users">
                All users <ArrowRight />
              </Link>
            </Button>
          }
        >
          {users.isLoading && <LoadingState rows={5} label="Loading users…" />}
          {users.isError && (
            <ErrorState message={users.error.message} onRetry={() => users.refetch()} />
          )}
          {users.data && recentUsers.length === 0 && (
            <EmptyState icon={Users} title="No users yet" />
          )}
          {recentUsers.length > 0 && (
            <ul className="glass divide-y divide-border rounded-2xl">
              {recentUsers.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{u.full_name || "Unnamed user"}</div>
                    <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <div className="flex gap-1">
                      {u.is_admin && <Badge variant="admin">Admin</Badge>}
                      {!u.is_active && <Badge variant="live">Disabled</Badge>}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Joined {format(new Date(u.created_at), "d MMM yyyy")}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Latest meetings"
          actions={
            <Button asChild variant="glass" size="sm">
              <Link to="/admin/meetings">
                All meetings <ArrowRight />
              </Link>
            </Button>
          }
        >
          {meetings.isLoading && <LoadingState rows={5} label="Loading meetings…" />}
          {meetings.isError && (
            <ErrorState message={meetings.error.message} onRetry={() => meetings.refetch()} />
          )}
          {meetings.data && recentMeetings.length === 0 && (
            <EmptyState icon={Video} title="No meetings yet" />
          )}
          {recentMeetings.length > 0 && (
            <ul className="glass divide-y divide-border rounded-2xl">
              {recentMeetings.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <Link
                      to="/meetings/$id"
                      params={{ id: m.id }}
                      className="block truncate font-medium hover:underline"
                    >
                      {m.title}
                    </Link>
                    <div className="truncate text-xs text-muted-foreground">
                      {m.host_name || m.host_email || "Unknown host"} ·{" "}
                      {format(new Date(m.created_at), "d MMM yyyy")}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {m.has_summary && (
                      <CheckCircle2 className="h-4 w-4 text-success" aria-label="Has summary" />
                    )}
                    <StatusBadge kind="meeting" status={m.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <UserCheck className="h-4 w-4" /> Admin access is granted in the database only; there is no
        self-service admin sign-up.
      </p>
    </div>
  );
}
