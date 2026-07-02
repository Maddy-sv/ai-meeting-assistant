import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Video, MessageSquare, CalendarDays, User, Shield, LogOut, Sparkles, Bell, Search } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/meetings", label: "Meetings", icon: Video },
  { to: "/chat", label: "AI Chat", icon: MessageSquare },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/profile", label: "Profile", icon: User },
  { to: "/admin", label: "Admin", icon: Shield },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [email, setEmail] = useState<string>("");
  const [name, setName] = useState<string>("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? "");
      const meta = data.user?.user_metadata as { full_name?: string; name?: string } | undefined;
      setName(meta?.full_name || meta?.name || (data.user?.email?.split("@")[0] ?? ""));
    });
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    toast.success("Signed out");
    router.navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto grid min-h-screen max-w-[1600px] grid-cols-[minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Sidebar */}
        <aside className="glass sticky top-0 hidden h-screen flex-col gap-2 border-r p-4 lg:flex">
          <Link to="/dashboard" className="mb-4 flex items-center gap-2 px-2">
            <div className="gradient-bg grid h-9 w-9 place-items-center rounded-xl shadow-glow">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <div className="text-lg font-bold tracking-tight">Zeta</div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">AI workspace</div>
            </div>
          </Link>
          <nav className="mt-2 flex flex-col gap-1">
            {NAV.map(({ to, label, icon: Icon }) => {
              const active = pathname === to || pathname.startsWith(to + "/");
              return (
                <Link
                  key={to}
                  to={to}
                  className={
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition " +
                    (active
                      ? "gradient-bg text-primary-foreground shadow-glow"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground")
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto space-y-3">
            <div className="glass rounded-2xl p-3">
              <div className="truncate text-sm font-medium">{name || "You"}</div>
              <div className="truncate text-xs text-muted-foreground">{email}</div>
            </div>
            <Button variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={signOut}>
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
          </div>
        </aside>

        {/* Content */}
        <div className="flex min-h-screen flex-col">
          <header className="glass sticky top-0 z-10 flex items-center gap-3 border-b px-4 py-3 lg:px-8">
            <Link to="/dashboard" className="flex items-center gap-2 lg:hidden">
              <div className="gradient-bg grid h-8 w-8 place-items-center rounded-lg">
                <Sparkles className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-bold">Zeta</span>
            </Link>
            <div className="glass ml-auto hidden items-center gap-2 rounded-full px-3 py-1.5 md:flex md:w-96">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                placeholder="Search meetings, decisions, people…"
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <Button variant="ghost" size="icon" className="ml-auto md:ml-0">
              <Bell className="h-4 w-4" />
            </Button>
          </header>
          <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>

          {/* mobile bottom nav */}
          <nav className="glass sticky bottom-0 z-10 flex items-center justify-around border-t px-2 py-2 lg:hidden">
            {NAV.slice(0, 5).map(({ to, label, icon: Icon }) => {
              const active = pathname === to || pathname.startsWith(to + "/");
              return (
                <Link
                  key={to}
                  to={to}
                  className={
                    "flex flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 text-[10px] " +
                    (active ? "text-primary" : "text-muted-foreground")
                  }
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </div>
  );
}
