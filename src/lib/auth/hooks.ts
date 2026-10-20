import { useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { AuthContext, type AuthState } from "./context";
import { isAdminQueryOptions, profileQueryOptions } from "./queries";

/** Current Supabase session and whether it is still loading. Must be inside `AuthProvider`. */
export function useSession(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useSession must be used inside <AuthProvider>.");
  return ctx;
}

/** The signed-in Supabase user, or null. */
export function useUser() {
  return useSession().session?.user ?? null;
}

/** React Query result for the signed-in user's profile row. */
export function useProfile() {
  const user = useUser();
  return useQuery({ ...profileQueryOptions(user?.id ?? ""), enabled: !!user });
}

/** `true` only when the server confirms the user is an admin (via `is_admin()`). */
export function useIsAdmin(): boolean {
  const user = useUser();
  const { data } = useQuery({ ...isAdminQueryOptions(user?.id ?? ""), enabled: !!user });
  return data === true;
}

/** Best display name: profile name, then OAuth metadata, then the email's local part. */
export function useDisplayName(): string {
  const user = useUser();
  const { data: profile } = useProfile();
  const meta = (user?.user_metadata ?? {}) as { full_name?: string; name?: string };
  return (
    profile?.full_name?.trim() ||
    meta.full_name?.trim() ||
    meta.name?.trim() ||
    user?.email?.split("@")[0] ||
    ""
  );
}
