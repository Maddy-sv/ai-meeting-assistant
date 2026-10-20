import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { isAdminQueryOptions } from "@/lib/auth";

/**
 * Layout for every /admin/* page. The guard asks the database (`is_admin()`) on each
 * navigation; the admin RPCs also check `is_admin()` server-side, so this is defence in depth.
 */
export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async ({ context }) => {
    const admin = await context.queryClient.fetchQuery({
      ...isAdminQueryOptions(context.user.id),
      staleTime: 0,
    });
    if (!admin) {
      toast.error("You don't have access to the admin area.");
      throw redirect({ to: "/user/dashboard", replace: true });
    }
  },
  component: Outlet,
});
