import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { Bell, BellOff, Check, CheckCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useUser } from "@/lib/auth";
import type { NotificationRow } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import {
  isSafeInternalLink,
  notificationKeys,
  useLatestNotifications,
  useUnreadNotificationCount,
} from "./notifications";

export function NotificationsBell() {
  const user = useUser();
  const userId = user?.id ?? "";
  const queryClient = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const latest = useLatestNotifications();
  const unread = useUnreadNotificationCount();
  const unreadCount = unread.data ?? 0;

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => queryClient.invalidateQueries({ queryKey: notificationKeys.all(userId) }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);

  function refresh() {
    return queryClient.invalidateQueries({ queryKey: notificationKeys.all(userId) });
  }

  async function markRead(id: string) {
    const { error } = await supabase.from("notifications").update({ read: true }).eq("id", id);
    if (error) {
      toast.error("Could not mark the notification as read.");
      return;
    }
    await refresh();
  }

  async function markAllRead() {
    setMarkingAll(true);
    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", userId)
      .eq("read", false);
    setMarkingAll(false);
    if (error) {
      toast.error("Could not mark notifications as read.");
      return;
    }
    await refresh();
  }

  async function openNotification(n: NotificationRow) {
    if (!n.read) void markRead(n.id);
    if (isSafeInternalLink(n.link)) {
      setOpen(false);
      router.history.push(n.link);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative rounded-full"
          aria-label={
            unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications, none unread"
          }
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-xs leading-none font-bold text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(22rem,calc(100vw-2rem))] rounded-2xl border-border bg-popover p-0"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Notifications</h2>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 rounded-full text-xs"
            onClick={markAllRead}
            disabled={unreadCount === 0 || markingAll}
          >
            {markingAll ? <Loader2 className="animate-spin" /> : <CheckCheck />}
            Mark all as read
          </Button>
        </div>

        <div className="custom-scrollbar max-h-96 overflow-y-auto">
          {latest.isLoading && (
            <div role="status" className="space-y-2 p-4">
              <span className="sr-only">Loading notifications…</span>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full bg-muted" />
              ))}
            </div>
          )}

          {latest.isError && (
            <div role="alert" className="space-y-2 p-6 text-center text-sm">
              <p className="text-muted-foreground">Couldn't load notifications.</p>
              <Button variant="glass" size="sm" onClick={() => latest.refetch()}>
                Try again
              </Button>
            </div>
          )}

          {latest.data && latest.data.length === 0 && (
            <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
              <BellOff className="h-6 w-6" />
              You're all caught up.
            </div>
          )}

          {latest.data && latest.data.length > 0 && (
            <ul className="divide-y divide-border">
              {latest.data.map((n) => (
                <li
                  key={n.id}
                  className={cn("flex items-start gap-1 pr-2", !n.read && "bg-primary/5")}
                >
                  <button
                    type="button"
                    onClick={() => openNotification(n)}
                    className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/10 focus-visible:bg-accent/10 focus-visible:outline-none"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                        n.read ? "bg-transparent" : "bg-primary",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{n.title}</span>
                      {n.body && (
                        <span className="line-clamp-2 block text-xs text-muted-foreground">
                          {n.body}
                        </span>
                      )}
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                        {!n.read && <span className="sr-only"> (unread)</span>}
                      </span>
                    </span>
                  </button>
                  {!n.read && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="mt-2 shrink-0 rounded-full"
                      aria-label={`Mark "${n.title}" as read`}
                      onClick={() => markRead(n.id)}
                    >
                      <Check />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
