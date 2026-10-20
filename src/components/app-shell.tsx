import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
  Bot,
  CalendarDays,
  FolderKanban,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Menu,
  MessageSquare,
  Search,
  ShieldCheck,
  Sparkles,
  User,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { NotificationsBell } from "@/components/layout/notifications-bell";
import { useDisplayName, useIsAdmin, useUser } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const BRAND_NAME = "AI Meeting Companion";

interface NavItem {
  /** Plain path so routes added later (e.g. /search) can be listed before they exist. */
  to: string;
  label: string;
  icon: LucideIcon;
  /** Only highlight on an exact path match. */
  exact?: boolean;
}

const USER_NAV: NavItem[] = [
  { to: "/user/dashboard", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/meetings", label: "Meetings", icon: Video },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/todo", label: "Tasks", icon: ListTodo },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/chat", label: "Chat", icon: MessageSquare },
  { to: "/search", label: "Search", icon: Search },
  { to: "/profile", label: "Profile", icon: User },
];

const ADMIN_NAV: NavItem[] = [
  { to: "/admin/dashboard", label: "Admin overview", icon: ShieldCheck },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/meetings", label: "Meetings", icon: Video },
  { to: "/admin/ai", label: "AI usage", icon: Bot },
];

function isActive(pathname: string, item: NavItem) {
  if (item.exact) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(item.to + "/");
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

async function signOut(router: ReturnType<typeof useRouter>) {
  const { error } = await supabase.auth.signOut();
  if (error) {
    toast.error("Could not sign out. Please try again.");
    return;
  }
  toast.success("Signed out");
  router.navigate({ to: "/auth", replace: true });
}

/** Brand mark + name used in the sidebar and mobile drawer. */
function Brand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link to="/user/dashboard" onClick={onNavigate} className="flex items-center gap-2 px-2">
      <div className="gradient-bg grid h-9 w-9 shrink-0 place-items-center rounded-xl shadow-glow">
        <Sparkles className="h-5 w-5 text-primary-foreground" />
      </div>
      <span className="text-base font-bold leading-tight tracking-tight">{BRAND_NAME}</span>
    </Link>
  );
}

function NavList({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const active = isActive(pathname, item);
        const Icon = item.icon;
        return (
          <li key={item.to}>
            <Link
              // Cast: NavItem.to is a plain string (see NavItem).
              to={item.to as never}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "gradient-bg text-primary-foreground shadow-glow"
                  : "text-muted-foreground hover:bg-accent/10 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Sidebar body shared by the desktop sidebar and the mobile drawer. */
function SidebarContent({
  pathname,
  isAdmin,
  onNavigate,
}: {
  pathname: string;
  isAdmin: boolean;
  onNavigate?: () => void;
}) {
  const user = useUser();
  const name = useDisplayName();
  return (
    <div className="flex h-full flex-col gap-4">
      <Brand onNavigate={onNavigate} />
      <nav
        aria-label="Main"
        className="custom-scrollbar -mx-1 flex-1 space-y-6 overflow-y-auto px-1"
      >
        <NavList items={USER_NAV} pathname={pathname} onNavigate={onNavigate} />
        {isAdmin && (
          <div className="space-y-2">
            <div className="px-3 text-xs uppercase tracking-widest text-muted-foreground">
              Administration
            </div>
            <NavList items={ADMIN_NAV} pathname={pathname} onNavigate={onNavigate} />
          </div>
        )}
      </nav>
      <div className="glass rounded-2xl p-3">
        <div className="truncate text-sm font-medium">{name || "You"}</div>
        <div className="truncate text-xs text-muted-foreground">{user?.email}</div>
      </div>
    </div>
  );
}

/** Header search: submits to /search?q=… from any page. */
function HeaderSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const query = q.trim();
    router.history.push(query ? `/search?q=${encodeURIComponent(query)}` : "/search");
  }

  return (
    <form role="search" onSubmit={submit} className="relative hidden w-full max-w-md sm:block">
      <label htmlFor="global-search" className="sr-only">
        Search meetings, transcripts and tasks
      </label>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        id="global-search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search meetings, transcripts, tasks…"
        className="glass h-9 rounded-full pl-9"
      />
    </form>
  );
}

function UserMenu() {
  const router = useRouter();
  const user = useUser();
  const name = useDisplayName();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account menu">
          <span className="gradient-bg grid h-8 w-8 place-items-center rounded-full text-xs font-bold text-primary-foreground">
            {initials(name)}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 rounded-xl bg-popover">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-sm font-medium">{name || "You"}</div>
          <div className="truncate text-xs text-muted-foreground">{user?.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/profile">
            <User /> Profile & settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => void signOut(router)}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Authenticated layout: sidebar (desktop), drawer (mobile), header with search, bell and account. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isAdmin = useIsAdmin();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <div className="mx-auto grid min-h-screen max-w-[1600px] grid-cols-[minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="glass sticky top-0 hidden h-screen border-r p-4 lg:block">
          <SidebarContent pathname={pathname} isAdmin={isAdmin} />
        </aside>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-72 border-border bg-surface-1 p-4">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">Main navigation menu</SheetDescription>
            <SidebarContent
              pathname={pathname}
              isAdmin={isAdmin}
              onNavigate={() => setMobileOpen(false)}
            />
          </SheetContent>
        </Sheet>

        <div className="flex min-h-screen min-w-0 flex-col">
          <header className="glass sticky top-0 z-20 flex items-center gap-2 border-b px-4 py-3 lg:px-8">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Open navigation menu"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <Link
              to="/user/dashboard"
              className="flex items-center gap-2 lg:hidden"
              aria-label={`${BRAND_NAME} home`}
            >
              <div className="gradient-bg grid h-8 w-8 place-items-center rounded-lg">
                <Sparkles className="h-4 w-4 text-primary-foreground" />
              </div>
            </Link>

            <HeaderSearch />

            <div className="ml-auto flex items-center gap-1">
              <Button asChild variant="ghost" size="icon" className="rounded-full sm:hidden">
                <Link to={"/search" as never} aria-label="Search">
                  <Search className="h-4 w-4" />
                </Link>
              </Button>
              <NotificationsBell />
              <UserMenu />
            </div>
          </header>
          <main id="main-content" className="flex-1 px-4 py-6 lg:px-8 lg:py-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
