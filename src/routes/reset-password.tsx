import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Reset password — AI Powered Meeting Companion" }] }),
  component: ResetPassword,
});

function ResetPassword() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Supabase automatically parses the recovery token from the URL hash and creates a session.
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Password updated");
    router.navigate({ to: "/dashboard", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass w-full max-w-md rounded-3xl p-8 shadow-soft">
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="gradient-bg grid h-10 w-10 place-items-center rounded-xl"><Sparkles className="h-5 w-5 text-primary-foreground" /></div>
          <span className="text-xl font-bold">AI Powered Meeting Companion</span>
        </div>
        <h1 className="text-2xl font-bold">Set a new password</h1>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <Label>New password</Label>
            <Input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="glass mt-1 border-white/10" />
          </div>
          <Button type="submit" disabled={loading} className="gradient-bg w-full rounded-full shadow-glow">{loading ? "Updating…" : "Update password"}</Button>
        </form>
      </div>
    </div>
  );
}
