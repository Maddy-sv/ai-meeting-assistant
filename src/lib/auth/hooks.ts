import { useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { AuthContext, type AuthState } from "./context";
import { isAdminQueryOptions, profileQueryOptions } from "./queries";

export function useSession(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useSession must be used inside <AuthProvider>.");
  return ctx;
}

export function useUser() {
  return useSession().session?.user ?? null;
}

export function useProfile() {
  const user = useUser();
  return useQuery({ ...profileQueryOptions(user?.id ?? ""), enabled: !!user });
}

export function useIsAdmin(): boolean {
  const user = useUser();
  const { data } = useQuery({ ...isAdminQueryOptions(user?.id ?? ""), enabled: !!user });
  return data === true;
}

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
