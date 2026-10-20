import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isAdmin, type ProfileRow } from "@/lib/rpc";

export const authKeys = {
  all: ["auth"] as const,
  profile: (userId: string) => ["auth", "profile", userId] as const,
  isAdmin: (userId: string) => ["auth", "is-admin", userId] as const,
};

export function profileQueryOptions(userId: string) {
  return queryOptions({
    queryKey: authKeys.profile(userId),
    queryFn: async (): Promise<ProfileRow | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw new Error("Could not load your profile.");
      return (data as ProfileRow | null) ?? null;
    },
    staleTime: 60_000,
  });
}

export function isAdminQueryOptions(userId: string) {
  return queryOptions({
    queryKey: authKeys.isAdmin(userId),
    queryFn: async () => {
      try {
        return await isAdmin();
      } catch (error) {
        console.error("[auth] is_admin check failed", error);
        return false;
      }
    },
    staleTime: 60_000,
  });
}
