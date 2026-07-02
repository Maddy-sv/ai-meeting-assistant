import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Users, Video, Sparkles, HardDrive, DollarSign, Shield } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Admin — Zeta" }] }),
  component: AdminPage,
});

function AdminPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [stats, setStats] = useState({ users: 0, meetings: 0, summaries: 0, activeMeetings: 0 });

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
      const admin = (roles ?? []).some((r: any) => r.role === "admin");
      setIsAdmin(admin);
      if (!admin) return;
      const [{ count: users }, { count: meetings }, { count: summaries }, { count: active }] = await Promise.all([
        supabase.from("profiles").select("*", { count: "exact", head: true }),
        supabase.from("meetings").select("*", { count: "exact", head: true }),
        supabase.from("ai_summaries").select("*", { count: "exact", head: true }),
        supabase.from("meetings").select("*", { count: "exact", head: true }).eq("status", "live"),
      ]);
      setStats({ users: users ?? 0, meetings: meetings ?? 0, summaries: summaries ?? 0, activeMeetings: active ?? 0 });
    })();
  }, []);

  if (isAdmin === null) return <p className="text-sm text-muted-foreground">Loading…</p>;

  if (!isAdmin) {
    return (
      <div className="glass mx-auto max-w-lg rounded-3xl p-8 text-center">
        <Shield className="mx-auto mb-3 h-8 w-8 text-primary" />
        <h1 className="text-xl font-semibold">Admin only</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You don't have admin privileges yet. Ask a workspace admin to grant you the <code>admin</code> role in the <code>user_roles</code> table.
        </p>
      </div>
    );
  }

  const cards = [
    { label: "Total users", value: stats.users, icon: Users },
    { label: "Active meetings", value: stats.activeMeetings, icon: Video },
    { label: "AI summaries", value: stats.summaries, icon: Sparkles },
    { label: "Total meetings", value: stats.meetings, icon: HardDrive },
    { label: "Revenue (mock)", value: "$12,480", icon: DollarSign },
    { label: "Storage used (mock)", value: "42 GB", icon: HardDrive },
  ];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-black tracking-tight">Admin dashboard</h1>
        <p className="text-sm text-muted-foreground">Workspace health at a glance.</p>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="glass rounded-2xl p-5">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">{c.label}</div>
              <c.icon className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-3 text-3xl font-black">{c.value}</div>
          </div>
        ))}
      </section>

      <section className="glass rounded-2xl p-6">
        <h2 className="mb-3 text-lg font-semibold">User management</h2>
        <p className="text-sm text-muted-foreground">Full user management coming soon — you'll be able to promote/demote roles, revoke access and view audit logs.</p>
      </section>
    </div>
  );
}
