import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { profileQueryOptions } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ context, location }) => {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) {
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }

    // Disabled accounts (profiles.is_active = false) are signed out immediately.
    const profile = await context.queryClient
      .fetchQuery(profileQueryOptions(session.user.id))
      .catch(() => null);
    if (profile?.is_active === false) {
      await supabase.auth.signOut();
      toast.error("Your account has been disabled");
      throw redirect({ to: "/auth" });
    }

    return { user: session.user };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
