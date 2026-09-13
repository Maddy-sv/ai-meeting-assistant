import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ShieldCheck, Sparkles, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — AI Powered Meeting Companion" }, { name: "description", content: "Sign in to AI Powered Meeting Companion and let AI handle your meetings." }] }),
  component: AuthPage,
});

function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");
  const [role, setRole] = useState<"student" | "admin">("student");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted && data.session) router.navigate({ to: "/dashboard", replace: true });
    });
    return () => { mounted = false; };
  }, [router]);

  async function verifyAdminAndRedirect(userId: string) {
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
    
    if (isAdmin) {
      toast.success("Admin access granted.");
      router.navigate({ to: "/admin/dashboard", replace: true });
    } else {
      toast.error("Access Denied: You are not an administrator.");
      await supabase.auth.signOut();
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { data: { full_name: name, role: role === "admin" ? "admin" : "user" }, emailRedirectTo: window.location.origin + "/auth" },
        });
        if (error) throw error;
        toast.success("Account created. You're signed in.");
        router.navigate({ to: "/dashboard", replace: true });
      } else if (mode === "signin") {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        
        if (role === "admin" && data.user) {
          await verifyAdminAndRedirect(data.user.id);
        } else {
          router.navigate({ to: "/dashboard", replace: true });
        }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + "/reset-password" });
        if (error) throw error;
        toast.success("Password reset email sent.");
        setMode("signin");
      }
    } catch (e: any) {
      toast.error(e?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const isAdminMode = role === "admin";

  return (
    <div className={`flex min-h-screen items-center justify-center px-4 py-10 transition-colors duration-500 ${isAdminMode ? 'bg-zinc-950' : ''}`}>
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2">
          <div className={`grid h-10 w-10 place-items-center rounded-xl shadow-glow ${isAdminMode ? 'bg-red-600' : 'gradient-bg'}`}>
            {isAdminMode ? <ShieldCheck className="h-5 w-5 text-white" /> : <Sparkles className="h-5 w-5 text-primary-foreground" />}
          </div>
          <span className={`text-xl font-bold ${isAdminMode ? 'text-white' : ''}`}>AI Powered Meeting Companion</span>
        </Link>

        {(mode === "signin" || mode === "signup") && (
          <div className="mb-6 flex rounded-lg bg-black/10 p-1">
            <button
              onClick={() => setRole("student")}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition-all flex items-center justify-center gap-2 ${role === "student" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <UserIcon className="h-4 w-4" /> Student {mode === "signin" ? "Login" : "Sign Up"}
            </button>
            <button
              onClick={() => setRole("admin")}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition-all flex items-center justify-center gap-2 ${role === "admin" ? "bg-red-600 shadow text-white" : "text-muted-foreground hover:text-foreground"}`}
            >
              <ShieldCheck className="h-4 w-4" /> Admin {mode === "signin" ? "Login" : "Sign Up"}
            </button>
          </div>
        )}

        <div className={`glass rounded-3xl p-8 shadow-soft transition-all ${isAdminMode ? 'border-red-900/30 bg-zinc-900/50 text-white shadow-2xl backdrop-blur-xl' : ''}`}>
          <h1 className="text-2xl font-bold">
            {mode === "signin" 
              ? (role === "admin" ? "Admin Portal" : "Welcome back") 
              : mode === "signup" ? (role === "admin" ? "Create Admin Account" : "Create Student Account") : "Reset your password"}
          </h1>
          <p className={`mt-1 text-sm ${isAdminMode ? 'text-zinc-400' : 'text-muted-foreground'}`}>
            {mode === "signin" 
              ? (role === "admin" ? "Restricted access. Authorized personnel only." : "Sign in to your AI Powered Meeting Companion workspace") 
              : mode === "signup" ? (role === "admin" ? "Register a new administrator" : "Start automating your meetings") : "We'll email you a reset link"}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === "signup" && (
              <div>
                <Label htmlFor="name" className={isAdminMode ? 'text-zinc-400' : ''}>Full name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required className={`mt-1 ${isAdminMode ? 'border-white/10 bg-black/50 text-white focus:border-red-500' : 'glass border-white/10'}`} />
              </div>
            )}
            <div>
              <Label htmlFor="email" className={isAdminMode ? 'text-zinc-400' : ''}>Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={`mt-1 ${isAdminMode ? 'border-white/10 bg-black/50 text-white focus:border-red-500' : 'glass border-white/10'}`} />
            </div>
            {mode !== "reset" && (
              <div>
                <Label htmlFor="password" className={isAdminMode ? 'text-zinc-400' : ''}>Password</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className={`mt-1 ${isAdminMode ? 'border-white/10 bg-black/50 text-white focus:border-red-500' : 'glass border-white/10'}`} />
              </div>
            )}
            
            <Button 
              type="submit" 
              disabled={loading} 
              className={`w-full rounded-full transition-all ${
                isAdminMode 
                  ? 'bg-red-600 hover:bg-red-700 text-white shadow-[0_0_15px_rgba(220,38,38,0.3)] font-bold tracking-wide mt-6' 
                  : 'gradient-bg shadow-glow mt-6'
              }`}
            >
              {loading ? "Please wait…" : mode === "signin" ? (role === "admin" ? "Authorize" : "Sign in") : mode === "signup" ? (role === "admin" ? "Create Admin" : "Create Account") : "Send reset link"}
            </Button>
          </form>

          <div className="mt-6 flex flex-wrap justify-between gap-2 text-xs">
            {mode === "signin" ? (
              <>
                <button onClick={() => setMode("reset")} className={`${isAdminMode ? 'text-zinc-500 hover:text-white' : 'text-muted-foreground hover:text-foreground'}`}>Forgot password?</button>
                <button onClick={() => { setMode("signup"); }} className={`${isAdminMode ? 'text-zinc-500 hover:text-white' : 'text-muted-foreground hover:text-foreground'}`}>Create account</button>
              </>
            ) : (
              <button onClick={() => setMode("signin")} className={`${isAdminMode ? 'text-zinc-500 hover:text-white' : 'text-muted-foreground hover:text-foreground'}`}>← Back to sign in</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


