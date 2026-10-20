import { createFileRoute, redirect } from "@tanstack/react-router";
import { isAdminQueryOptions } from "@/lib/auth";

/** `/dashboard` is a router: admins go to the admin overview, everyone else to their workspace. */
export const Route = createFileRoute("/_authenticated/dashboard")({
  beforeLoad: async ({ context }) => {
    const admin = await context.queryClient.fetchQuery(isAdminQueryOptions(context.user.id));
    throw redirect({ to: admin ? "/admin/dashboard" : "/user/dashboard", replace: true });
  },
});
