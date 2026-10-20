import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AuthContext, type AuthState } from "./context";
import { authKeys } from "./queries";
import { clearLocalAppData, consumePostAuthRedirect } from "./storage";

/**
 * Single subscription to Supabase auth events for the whole app.
 * - keeps the session in React state (read it with `useSession`/`useUser`);
 * - on sign-out clears the React Query cache and local "ai_*" caches;
 * - re-runs route guards whenever the user changes.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ session: null, loading: true });

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setState({ session: data.session, loading: false });
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      setState({ session, loading: false });

      // Defer side effects: calling Supabase from inside this callback can deadlock.
      setTimeout(() => {
        if (event === "SIGNED_OUT") {
          queryClient.clear();
          clearLocalAppData();
          router.invalidate();
        } else if (event === "SIGNED_IN") {
          const target = consumePostAuthRedirect();
          if (target) router.history.push(target);
          router.invalidate();
        } else if (event === "USER_UPDATED") {
          queryClient.invalidateQueries({ queryKey: authKeys.all });
          router.invalidate();
        }
      }, 0);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [router, queryClient]);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
