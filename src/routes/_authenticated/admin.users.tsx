import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Search, ShieldCheck, ShieldOff, UserCheck, UserX, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from "@/components/layout";
import { useUser } from "@/lib/auth";
import { adminListUsers, adminSetUserActive, adminSetUserRole, type AdminUser } from "@/lib/rpc";

export const Route = createFileRoute("/_authenticated/admin/users")({
  head: () => ({ meta: [{ title: "Users — Admin — AI Meeting Companion" }] }),
  component: AdminUsers,
});

type PendingAction = { kind: "role" | "active"; user: AdminUser } | null;

function AdminUsers() {
  const me = useUser();
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: ["admin", "users"], queryFn: adminListUsers });
  const [q, setQ] = useState("");
  const [pending, setPending] = useState<PendingAction>(null);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = users.data ?? [];
    if (!term) return list;
    return list.filter(
      (u) =>
        (u.full_name ?? "").toLowerCase().includes(term) ||
        (u.email ?? "").toLowerCase().includes(term),
    );
  }, [users.data, q]);

  async function confirmPending() {
    if (!pending) return;
    const { kind, user } = pending;
    if (kind === "role") {
      await adminSetUserRole(user.id, !user.is_admin);
      toast.success(user.is_admin ? "Admin role removed" : "Admin role granted");
    } else {
      await adminSetUserActive(user.id, !user.is_active);
      toast.success(user.is_active ? "Account disabled" : "Account enabled");
    }
    await queryClient.invalidateQueries({ queryKey: ["admin"] });
  }

  const label = (u: AdminUser) => u.full_name || u.email || "this user";
  const dialog = pending
    ? pending.kind === "role"
      ? {
          title: pending.user.is_admin ? "Remove admin role?" : "Make this user an admin?",
          description: pending.user.is_admin
            ? `${label(pending.user)} will lose access to the admin area.`
            : `${label(pending.user)} will be able to see every user and meeting.`,
          confirmLabel: pending.user.is_admin ? "Remove admin" : "Make admin",
          destructive: pending.user.is_admin,
        }
      : {
          title: pending.user.is_active ? "Disable this account?" : "Enable this account?",
          description: pending.user.is_active
            ? `${label(pending.user)} will be signed out the next time they use the app and can't sign back in until re-enabled. Their data is kept.`
            : `${label(pending.user)} will be able to sign in again.`,
          confirmLabel: pending.user.is_active ? "Disable account" : "Enable account",
          destructive: pending.user.is_active,
        }
    : null;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Administration"
        title="Users"
        description="Everyone with an account. Grant admin access or disable accounts."
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:max-w-sm">
          <label htmlFor="user-search" className="sr-only">
            Search users by name or email
          </label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="user-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or email…"
            className="glass rounded-full pl-9"
          />
        </div>
        {users.data && (
          <span className="text-sm text-muted-foreground">
            {filtered.length} of {users.data.length} users
          </span>
        )}
      </div>

      {users.isLoading && <LoadingState variant="table" rows={6} label="Loading users…" />}
      {users.isError && (
        <ErrorState message={users.error.message} onRetry={() => users.refetch()} />
      )}
      {users.data && filtered.length === 0 && (
        <EmptyState
          icon={Users}
          title={q ? "No users match your search" : "No users yet"}
          description={q ? "Try a different name or email." : undefined}
        />
      )}

      {filtered.length > 0 && (
        <div className="glass overflow-x-auto rounded-2xl">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Meetings</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((u) => {
                const isMe = u.id === me?.id;
                return (
                  <TableRow key={u.id} className="border-border">
                    <TableCell className="min-w-48">
                      <div className="font-medium">
                        {u.full_name || "Unnamed user"}
                        {isMe && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </TableCell>
                    <TableCell>
                      {u.is_admin ? (
                        <Badge variant="admin">Admin</Badge>
                      ) : (
                        <Badge variant="muted">User</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {u.is_active ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="live">Disabled</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{u.meeting_count}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {format(new Date(u.created_at), "d MMM yyyy")}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {u.last_sign_in_at
                        ? format(new Date(u.last_sign_in_at), "d MMM yyyy, HH:mm")
                        : "Never"}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="glass"
                          size="sm"
                          disabled={isMe}
                          title={isMe ? "You can't change your own role" : undefined}
                          onClick={() => setPending({ kind: "role", user: u })}
                        >
                          {u.is_admin ? <ShieldOff /> : <ShieldCheck />}
                          {u.is_admin ? "Remove admin" : "Make admin"}
                        </Button>
                        <Button
                          variant={u.is_active ? "destructive" : "glass"}
                          size="sm"
                          className="rounded-full"
                          disabled={isMe}
                          title={isMe ? "You can't disable your own account" : undefined}
                          onClick={() => setPending({ kind: "active", user: u })}
                        >
                          {u.is_active ? <UserX /> : <UserCheck />}
                          {u.is_active ? "Disable" : "Enable"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {dialog && (
        <ConfirmDialog
          open={!!pending}
          onOpenChange={(open) => !open && setPending(null)}
          title={dialog.title}
          description={dialog.description}
          confirmLabel={dialog.confirmLabel}
          destructive={dialog.destructive}
          onConfirm={confirmPending}
        />
      )}
    </div>
  );
}
