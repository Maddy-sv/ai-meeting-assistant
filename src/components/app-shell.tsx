import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { 
  LayoutDashboard, Video, MessageSquare, CalendarDays, User, LogOut, 
  Sparkles, Bell, Search, ListTodo, ShieldAlert, Users, Zap, 
  TrendingUp, FileText, Lock, Settings, ShieldCheck, Menu, X, FolderKanban
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const USER_NAV = [
  { to: "/user/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/meetings", label: "My Meetings", icon: Video },
  { to: "/todo", label: "Tasks", icon: ListTodo },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/chat", label: "AI Chat Bot", icon: MessageSquare },
  { to: "/profile", label: "Profile & Settings", icon: User },
] as const;

const ADMIN_NAV = [
  { to: "/admin/dashboard", label: "Admin Overview", icon: ShieldAlert },
  { to: "/admin/users", label: "User Management", icon: Users },
  { to: "/admin/meetings", label: "Meeting Management", icon: Video },
  { to: "/admin/ai", label: "AI Processing", icon: Zap },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [email, setEmail] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Close mobile menu on route change
  useEffect(() => { setMobileMenuOpen(false); }, [pathname]);

  useEffect(() => {
    async function loadUser() {
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        setEmail(data.user.email ?? "");
        const meta = data.user.user_metadata as { full_name?: string; name?: string } | undefined;
        let displayName = meta?.full_name || meta?.name || (data.user.email?.split("@")[0] ?? "");
        
        const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", data.user.id).maybeSingle();
        if ((prof as any)?.full_name) {
          displayName = (prof as any).full_name;
        }
        setName(displayName);

        supabase.from("user_roles").select("role").eq("user_id", data.user.id).then(({ data: roles }) => {
          setIsAdmin((roles ?? []).some((r: any) => r.role === "admin"));
        });
      }
    }

    loadUser();

    const { data: authListener } = supabase.auth.onAuthStateChange(() => {
      loadUser();
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    toast.success("Signed out");
    router.navigate({ to: "/auth", replace: true });
  }

  const inAdminWorkspace = pathname.startsWith("/admin");
  const currentNav = inAdminWorkspace ? ADMIN_NAV : USER_NAV;

  const SidebarContent = () => (
    <>
      <Link to={inAdminWorkspace ? "/admin/dashboard" : "/user/dashboard"} className="mb-4 flex items-center gap-2 px-2">
        <div className={`grid h-9 w-9 place-items-center rounded-xl shadow-glow ${inAdminWorkspace ? 'bg-red-600' : 'gradient-bg'}`}>
          {inAdminWorkspace ? <ShieldAlert className="h-5 w-5 text-white" /> : <Sparkles className="h-5 w-5 text-primary-foreground" />}
        </div>
        <div>
          <div className="text-lg font-bold tracking-tight">AI Companion</div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {inAdminWorkspace ? "Admin Center" : "Workspace"}
          </div>
        </div>
      </Link>
      
      <nav className="mt-2 flex flex-col gap-1 overflow-y-auto pb-4">
        {currentNav.map(({ to, label, icon: Icon }) => {
          const active = pathname === to || pathname.startsWith(to + "/") && to !== "/user/dashboard" && to !== "/admin/dashboard";
          return (
            <Link
              key={label}
              to={to}
              className={
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition " +
                (active
                  ? (inAdminWorkspace ? "bg-red-600 text-white shadow-[0_0_10px_rgba(220,38,38,0.3)]" : "gradient-bg text-primary-foreground shadow-glow")
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground")
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{label}</span>
            </Link>
          );
        })}

        {/* Workspace Switcher for Admins */}
        {isAdmin && !inAdminWorkspace && (
          <div className="mt-4 pt-4 border-t border-white/5">
            <Link to="/admin/dashboard" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span>Switch to Admin</span>
            </Link>
          </div>
        )}
        {isAdmin && inAdminWorkspace && (
          <div className="mt-4 pt-4 border-t border-white/5">
            <Link to="/user/dashboard" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-blue-400 hover:bg-blue-500/10 transition">
              <LayoutDashboard className="h-4 w-4 shrink-0" />
              <span>Switch to User</span>
            </Link>
          </div>
        )}
      </nav>

      <div className="mt-auto space-y-3 pt-4 border-t border-white/5">
        <div className="glass rounded-2xl p-3">
          <div className="truncate text-sm font-medium">{name || "You"}</div>
          <div className="truncate text-xs text-muted-foreground">{email}</div>
        </div>
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-muted-foreground hover:text-red-400 hover:bg-red-500/10" onClick={signOut}>
          <LogOut className="h-4 w-4" /> Sign out
        </Button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen">
      <div className="mx-auto grid min-h-screen max-w-[1600px] grid-cols-[minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)]">
        
        {/* Desktop Sidebar */}
        <aside className="glass sticky top-0 hidden h-screen flex-col gap-2 border-r p-4 lg:flex">
          <SidebarContent />
        </aside>

        {/* Mobile Sidebar Overlay */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 flex lg:hidden">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
            <aside className="relative flex w-3/4 max-w-[300px] flex-col gap-2 bg-zinc-950 border-r border-white/10 p-4 shadow-2xl h-full animate-in slide-in-from-left-full">
              <Button variant="ghost" size="icon" className="absolute right-2 top-2 text-muted-foreground" onClick={() => setMobileMenuOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
              <SidebarContent />
            </aside>
          </div>
        )}

        {/* Content */}
        <div className="flex min-h-screen flex-col">
          <header className="glass sticky top-0 z-10 flex items-center gap-3 border-b px-4 py-3 lg:px-8">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileMenuOpen(true)}>
              <Menu className="h-5 w-5" />
            </Button>
            
            <Link to={inAdminWorkspace ? "/admin/dashboard" : "/user/dashboard"} className="flex items-center gap-2 lg:hidden ml-2">
              <div className={`grid h-8 w-8 place-items-center rounded-lg ${inAdminWorkspace ? 'bg-red-600' : 'gradient-bg'}`}>
                {inAdminWorkspace ? <ShieldAlert className="h-4 w-4 text-white" /> : <Sparkles className="h-4 w-4 text-primary-foreground" />}
              </div>
            </Link>
            

            <Button variant="ghost" size="icon" className="ml-auto md:ml-0">
              <Bell className="h-4 w-4" />
            </Button>
          </header>
          <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
