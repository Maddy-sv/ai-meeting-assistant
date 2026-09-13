import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardRedirector,
});

function DashboardRedirector() {
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: u }) => {
      if (!u.user) {
        router.navigate({ to: "/auth", replace: true });
        return;
      }
      
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
      const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");

      if (isAdmin) {
        router.navigate({ to: "/admin/dashboard", replace: true });
      } else {
        router.navigate({ to: "/user/dashboard", replace: true });
      }
    });
  }, [router]);

  return (
    <div className="grid h-[50vh] place-items-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <span className="sr-only">Routing to workspace...</span>
    </div>
  );
}
