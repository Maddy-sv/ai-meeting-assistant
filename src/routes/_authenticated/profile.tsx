import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { UserIdentity } from "@supabase/supabase-js";
import { CheckCircle2, FlaskConical, KeyRound, Link2, Loader2, LogOut, Mail } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { GOOGLE_ENABLED } from "@/lib/features";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog, ErrorState, LoadingState, PageHeader, Section } from "@/components/layout";
import { authKeys, useProfile, useUser } from "@/lib/auth";
import { seedDemoWorkspace, type ProfileRow } from "@/lib/rpc";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({ meta: [{ title: "Profile — AI Powered Meeting Companion" }] }),
  component: ProfilePage,
});

const FALLBACK_TIME_ZONES = [
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "mr", label: "Marathi" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
];

function supportedTimeZones(): string[] {
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    const zones = intl.supportedValuesOf?.("timeZone");
    if (zones && zones.length > 0) return zones.includes("UTC") ? zones : ["UTC", ...zones];
  } catch {}
  return FALLBACK_TIME_ZONES;
}

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

const profileSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(2, "Your name must be at least 2 characters.")
    .max(80, "Keep your name under 80 characters."),
  company: z.string().trim().max(100, "Keep it under 100 characters."),
  time_zone: z.string().min(1, "Choose a time zone."),
  language: z.string().min(1, "Choose a language."),
});
type ProfileValues = z.infer<typeof profileSchema>;

const passwordSchema = z
  .object({
    password: z
      .string()
      .min(8, "Use at least 8 characters.")
      .max(72, "Passwords can be at most 72 characters."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "The passwords do not match.",
  });
type PasswordValues = z.infer<typeof passwordSchema>;

function ProfilePage() {
  const user = useUser();
  const profile = useProfile();

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        title="Your profile"
        description="Manage your details, connected accounts and security."
      />
      {(profile.isLoading || !user) && (
        <LoadingState variant="list" rows={3} label="Loading profile…" />
      )}
      {profile.isError && (
        <ErrorState message={profile.error.message} onRetry={() => profile.refetch()} />
      )}
      {user && profile.isSuccess && (
        <>
          <ProfileDetails profile={profile.data} />
          {GOOGLE_ENABLED && <ConnectedAccounts />}
          <SecurityCard />
          <DemoWorkspaceCard />
        </>
      )}
    </div>
  );
}

function ProfileDetails({ profile }: { profile: ProfileRow | null }) {
  const user = useUser();
  const queryClient = useQueryClient();
  const meta = (user?.user_metadata ?? {}) as {
    full_name?: string;
    name?: string;
    avatar_url?: string;
    picture?: string;
  };
  const timeZones = useMemo(supportedTimeZones, []);

  const defaults: ProfileValues = {
    full_name: profile?.full_name?.trim() || meta.full_name || meta.name || "",
    company: profile?.company ?? "",
    time_zone: profile?.time_zone || browserTimeZone(),
    language: profile?.language || "en",
  };
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: defaults,
  });

  const watchedName = form.watch("full_name");
  const currentZone = form.watch("time_zone");
  const zoneOptions = timeZones.includes(currentZone) ? timeZones : [currentZone, ...timeZones];
  const avatarUrl = profile?.avatar_url || meta.avatar_url || meta.picture || undefined;
  const displayName = watchedName?.trim() || user?.email || "";

  async function onSubmit(values: ProfileValues) {
    if (!user) return;
    const { error } = await supabase.from("profiles").upsert({
      id: user.id,
      full_name: values.full_name,
      company: values.company || null,
      time_zone: values.time_zone,
      language: values.language,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      console.error("[profile] save failed", error);
      toast.error("Could not save your profile. Please try again.");
      return;
    }

    const { error: metaError } = await supabase.auth.updateUser({
      data: { full_name: values.full_name, name: values.full_name },
    });
    if (metaError) console.error("[profile] metadata sync failed", metaError);
    await queryClient.invalidateQueries({ queryKey: authKeys.profile(user.id) });
    form.reset(values);
    toast.success("Profile saved.");
  }

  return (
    <Section card title="Details">
      <div className="mb-6 flex items-center gap-4">
        <Avatar className="h-16 w-16">
          {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
          <AvatarFallback className="gradient-bg text-lg font-bold text-primary-foreground">
            {initials(displayName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-semibold">{displayName || "Your name"}</div>
          <div className="truncate text-sm text-muted-foreground">{user?.email}</div>
        </div>
        {profile?.subscription_plan && (
          <Badge variant="muted" className="capitalize">
            {profile.subscription_plan} plan
          </Badge>
        )}
      </div>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="grid gap-4 md:grid-cols-2"
          noValidate
        >
          <FormField
            control={form.control}
            name="full_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Full name</FormLabel>
                <FormControl>
                  <Input autoComplete="name" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="company"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Company or college (optional)</FormLabel>
                <FormControl>
                  <Input autoComplete="organization" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="time_zone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Time zone</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent className="max-h-72">
                    {zoneOptions.map((z) => (
                      <SelectItem key={z} value={z}>
                        {z.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="language"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Language</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                    {!LANGUAGES.some((l) => l.value === field.value) && field.value && (
                      <SelectItem value={field.value}>{field.value}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="md:col-span-2">
            <Button
              type="submit"
              variant="brand"
              disabled={form.formState.isSubmitting || !form.formState.isDirty}
            >
              {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
              {form.formState.isSubmitting ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </Form>
    </Section>
  );
}

function ConnectedAccounts() {
  const user = useUser();
  const queryClient = useQueryClient();
  const [linking, setLinking] = useState(false);
  const identitiesKey = ["auth", "identities", user?.id ?? ""] as const;

  const identities = useQuery({
    queryKey: identitiesKey,
    queryFn: async (): Promise<UserIdentity[]> => {
      const { data, error } = await supabase.auth.getUserIdentities();
      if (error) throw new Error("Could not load your connected accounts.");
      return data.identities;
    },
    enabled: !!user,
  });

  const list = identities.data ?? [];
  const google = list.find((i) => i.provider === "google");
  const emailIdentity = list.find((i) => i.provider === "email");

  async function connectGoogle() {
    setLinking(true);
    const { error } = await supabase.auth.linkIdentity({
      provider: "google",
      options: {
        scopes: "https://www.googleapis.com/auth/calendar.readonly",
        redirectTo: `${window.location.origin}/profile`,
      },
    });
    if (error) {
      console.error("[profile] linkIdentity failed", error);
      toast.error("Could not connect Google. Please try again.");
      setLinking(false);
    }
  }

  async function disconnectGoogle() {
    if (!google) return;
    const { error } = await supabase.auth.unlinkIdentity(google);
    if (error) {
      console.error("[profile] unlinkIdentity failed", error);
      throw new Error("Could not disconnect Google. Please try again.");
    }
    await supabase.auth.refreshSession();
    await queryClient.invalidateQueries({ queryKey: identitiesKey });
    toast.success("Google disconnected.");
  }

  return (
    <Section card title="Connected accounts" description="Ways you can sign in and data sources.">
      {identities.isLoading && <LoadingState variant="list" rows={2} label="Loading accounts…" />}
      {identities.isError && (
        <ErrorState message={identities.error.message} onRetry={() => identities.refetch()} />
      )}
      {identities.isSuccess && (
        <ul className="space-y-3">
          <li className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-1 p-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/15 text-primary">
              <Mail className="h-4 w-4" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium">Email and password</div>
              <div className="truncate text-xs text-muted-foreground">{user?.email}</div>
            </div>
            {emailIdentity ? (
              <Badge variant="success">
                <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden /> Connected
              </Badge>
            ) : (
              <Badge variant="muted">Not set up</Badge>
            )}
          </li>
          <li className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-1 p-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/15 text-primary">
              <Link2 className="h-4 w-4" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium">Google</div>
              <div className="text-xs text-muted-foreground">
                {google
                  ? `Sign-in and Calendar import${
                      (google.identity_data as { email?: string } | undefined)?.email
                        ? ` · ${(google.identity_data as { email?: string }).email}`
                        : ""
                    }`
                  : "Sign in with Google and import Calendar events."}
              </div>
            </div>
            {google ? (
              <div className="flex items-center gap-2">
                <Badge variant="success">
                  <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden /> Connected
                </Badge>
                {list.length > 1 ? (
                  <ConfirmDialog
                    title="Disconnect Google?"
                    description="You will no longer be able to sign in with Google or import Calendar events until you connect it again."
                    confirmLabel="Disconnect"
                    destructive
                    onConfirm={disconnectGoogle}
                    trigger={
                      <Button variant="ghost" size="sm">
                        Disconnect
                      </Button>
                    }
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">Only sign-in method</span>
                )}
              </div>
            ) : (
              <Button variant="glass" size="sm" onClick={connectGoogle} disabled={linking}>
                {linking && <Loader2 className="animate-spin" />}
                Connect
              </Button>
            )}
          </li>
        </ul>
      )}
    </Section>
  );
}

function SecurityCard() {
  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: "", confirm: "" },
  });

  async function onSubmit(values: PasswordValues) {
    const { error } = await supabase.auth.updateUser({ password: values.password });
    if (error) {
      console.error("[profile] password change failed", error);
      toast.error(
        error.message.toLowerCase().includes("different")
          ? "Choose a password that is different from your current one."
          : "Could not change your password. Please try again.",
      );
      return;
    }
    form.reset();
    toast.success("Password changed.");
  }

  async function signOutOthers() {
    const { error } = await supabase.auth.signOut({ scope: "others" });
    if (error) {
      console.error("[profile] sign out others failed", error);
      throw new Error("Could not sign out your other sessions. Please try again.");
    }
    toast.success("Signed out of all other devices.");
  }

  return (
    <Section card title="Security">
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="grid gap-4 md:grid-cols-2"
          noValidate
        >
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>New password</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="new-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirm"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Confirm new password</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="new-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex flex-wrap gap-2 md:col-span-2">
            <Button type="submit" variant="brand" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? <Loader2 className="animate-spin" /> : <KeyRound />}
              Change password
            </Button>
            <ConfirmDialog
              title="Sign out of other devices?"
              description="Every other browser or device signed in to your account will be signed out. This device stays signed in."
              confirmLabel="Sign out others"
              onConfirm={signOutOthers}
              trigger={
                <Button type="button" variant="glass">
                  <LogOut /> Sign out other sessions
                </Button>
              }
            />
          </div>
        </form>
      </Form>
    </Section>
  );
}

function DemoWorkspaceCard() {
  const queryClient = useQueryClient();

  async function loadDemo() {
    const result = await seedDemoWorkspace();
    if (!result.created) {
      toast.info("Demo workspace is already loaded.");
    } else {
      toast.success(
        `Demo workspace added: ${result.meeting_ids.length} sample meetings with transcripts, summaries and tasks.`,
      );
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["meetings"] }),
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      queryClient.invalidateQueries({ queryKey: ["user-dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["notifications"] }),
    ]);
  }

  return (
    <Section
      card
      title="Demo workspace"
      description="Explore the app with a sample project and two meetings from the research scenario."
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          The demo is added to your account only. You can delete it like any other meeting.
        </p>
        <ConfirmDialog
          title="Load the demo workspace?"
          description="This adds a sample project with two meetings, their transcripts, summaries, tasks and decisions to your account. Nobody else will see them."
          confirmLabel="Load demo"
          onConfirm={loadDemo}
          trigger={
            <Button variant="glass" className="shrink-0">
              <FlaskConical /> Load demo workspace
            </Button>
          }
        />
      </div>
    </Section>
  );
}
