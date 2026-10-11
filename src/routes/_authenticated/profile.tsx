import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle2, Mail } from "lucide-react";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({ meta: [{ title: "Profile — AI Powered Meeting Companion" }] }),
  component: ProfilePage,
});

type Profile = { id: string; full_name: string | null; avatar_url: string | null; company: string | null; time_zone: string | null; language: string | null; subscription_plan: string };

function ProfilePage() {
  const [p, setP] = useState<Profile | null>(null);
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      setEmail(u.user.email ?? "");
      const { data } = await supabase.from("profiles").select("*").eq("id", u.user.id).maybeSingle();
      if (data) {
        setP(data as Profile);
      } else {
        const meta = u.user.user_metadata as any;
        const initialProfile: Profile = {
          id: u.user.id,
          full_name: meta?.full_name || meta?.name || u.user.email?.split("@")[0] || "",
          avatar_url: meta?.avatar_url || null,
          company: meta?.company || "",
          time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          language: "en",
          subscription_plan: "free"
        };
        setP(initialProfile);
        supabase.from("profiles").upsert({
          id: initialProfile.id,
          full_name: initialProfile.full_name,
          company: initialProfile.company,
          time_zone: initialProfile.time_zone,
          language: initialProfile.language,
        }).then(() => {});
      }
    })();
  }, []);

  async function save() {
    if (!p) return;
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const userId = u.user?.id || p.id;

      // 1. Upsert into database
      const { error: pErr } = await supabase.from("profiles").upsert({
        id: userId,
        full_name: p.full_name,
        company: p.company,
        time_zone: p.time_zone,
        language: p.language,
        updated_at: new Date().toISOString()
      });

      if (pErr) throw pErr;

      // 2. Sync to auth metadata so session and sidebar stay updated
      await supabase.auth.updateUser({
        data: {
          full_name: p.full_name,
          name: p.full_name,
          company: p.company,
        }
      });

      toast.success("Profile saved successfully");
    } catch (err: any) {
      console.error("Profile update error:", err);
      toast.error(err?.message || "Failed to update profile");
    } finally {
      setSaving(false);
    }
  }

  if (!p) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-3xl font-black tracking-tight">Your profile</h1>
        <p className="text-sm text-muted-foreground">Update your account, preferences and connected services.</p>
      </header>

      <div className="glass flex items-center gap-4 rounded-2xl p-6">
        <div className="gradient-bg grid h-16 w-16 place-items-center rounded-full text-xl font-bold text-primary-foreground">
          {(p.full_name || email)?.[0]?.toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-semibold">{p.full_name || "Unnamed"}</div>
          <div className="truncate text-sm text-muted-foreground">{email}</div>
        </div>
      </div>

      <div className="glass grid gap-4 rounded-2xl p-6 md:grid-cols-2">
        <div>
          <Label>Full name</Label>
          <Input className="glass mt-1 border-white/10" value={p.full_name ?? ""} onChange={(e) => setP({ ...p, full_name: e.target.value })} />
        </div>
        <div>
          <Label>Company</Label>
          <Input className="glass mt-1 border-white/10" value={p.company ?? ""} onChange={(e) => setP({ ...p, company: e.target.value })} />
        </div>
        <div>
          <Label>Time zone</Label>
          <Input className="glass mt-1 border-white/10" value={p.time_zone ?? ""} onChange={(e) => setP({ ...p, time_zone: e.target.value })} />
        </div>
        <div>
          <Label>Language</Label>
          <Input className="glass mt-1 border-white/10" value={p.language ?? ""} onChange={(e) => setP({ ...p, language: e.target.value })} />
        </div>
        <div className="md:col-span-2">
          <Button className="gradient-bg rounded-full shadow-glow" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
        </div>
      </div>

      <div className="glass rounded-2xl p-6">
        <h3 className="mb-3 font-semibold">Connected accounts</h3>
        <div className="space-y-2">
          <Row icon={<Mail className="h-4 w-4" />} name="Google" desc="Sign-in, Calendar, Gmail" connected />
          <Row icon={<Mail className="h-4 w-4" />} name="Microsoft" desc="Teams integration" />
        </div>
      </div>
    </div>
  );
}

function Row({ icon, name, desc, connected }: { icon: React.ReactNode; name: string; desc: string; connected?: boolean }) {
  return (
    <div className="glass flex items-center gap-3 rounded-xl p-3">
      <div className="grid h-10 w-10 place-items-center rounded-lg bg-white/5">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{name}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      {connected ? (
        <Badge variant="outline" className="border-white/10"><CheckCircle2 className="mr-1 h-3 w-3 text-green-500" />Connected</Badge>
      ) : (
        <Button variant="outline" size="sm" className="glass rounded-full border-white/10">Connect</Button>
      )}
    </div>
  );
}
