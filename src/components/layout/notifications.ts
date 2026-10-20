import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUser } from "@/lib/auth";
import type { NotificationRow } from "@/lib/rpc";

export const notificationKeys = {
  all: (userId: string) => ["notifications", userId] as const,
  latest: (userId: string) => ["notifications", userId, "latest"] as const,
  unread: (userId: string) => ["notifications", userId, "unread"] as const,
};

export function useLatestNotifications() {
  const user = useUser();
  const userId = user?.id ?? "";
  return useQuery({
    queryKey: notificationKeys.latest(userId),
    enabled: !!user,
    queryFn: async (): Promise<NotificationRow[]> => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw new Error("Could not load notifications.");
      return (data ?? []) as NotificationRow[];
    },
  });
}

export function useUnreadNotificationCount() {
  const user = useUser();
  const userId = user?.id ?? "";
  return useQuery({
    queryKey: notificationKeys.unread(userId),
    enabled: !!user,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("read", false);
      if (error) throw new Error("Could not load notifications.");
      return count ?? 0;
    },
  });
}

export function isSafeInternalLink(link: string | null | undefined): link is string {
  return !!link && link.startsWith("/") && !link.startsWith("//") && !link.startsWith("/\\");
}
