import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { KeyRound, Link2Off, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { clearRecoverySession, hasRecoverySession } from "@/lib/auth";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({ meta: [{ title: "Reset password — AI Meeting Companion" }] }),
  component: ResetPassword,
});

const schema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters").max(72, "Use at most 72 characters"),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });
type Values = z.infer<typeof schema>;

type Status = "checking" | "ready" | "invalid";

/** Reads an error Supabase appended to the link (e.g. `#error_code=otp_expired`). */
function linkError(): string | null {
  const params = new URLSearchParams(
    window.location.hash.replace(/^#/, "") || window.location.search.replace(/^\?/, ""),
  );
  return params.get("error_code") || params.get("error");
}

function ResetPassword() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("checking");
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    const err = linkError();
    if (err) {
      setReason(err === "otp_expired" ? "expired" : "invalid");
      setStatus("invalid");
      return;
    }
    let mounted = true;

    function evaluate(hasSession: boolean) {
      if (!mounted) return;
      // Only a session created by a password-recovery link may use this form.
      setStatus(hasSession && hasRecoverySession() ? "ready" : "invalid");
    }

    // getSession waits for Supabase to finish parsing the recovery link in the URL.
    supabase.auth.getSession().then(({ data }) => evaluate(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") evaluate(!!session);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  async function onSubmit({ password }: Values) {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      if (error.code === "same_password") {
        toast.error("Choose a password you haven't used before.");
      } else if (error.code === "weak_password") {
        toast.error("That password is too weak or has appeared in a data breach.");
      } else {
        toast.error("We couldn't update your password. Request a new reset link and try again.");
      }
      return;
    }
    clearRecoverySession();
    // Sign out every other device that might be using the old password.
    const { error: signOutError } = await supabase.auth.signOut({ scope: "others" });
    if (signOutError) console.error("[auth] could not sign out other sessions", signOutError);
    toast.success("Password updated. Other devices have been signed out.");
    router.navigate({ to: "/dashboard", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="glass w-full max-w-md rounded-3xl p-6 shadow-soft sm:p-8">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2">
          <div className="gradient-bg grid h-10 w-10 place-items-center rounded-xl shadow-glow">
            <Sparkles className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-bold tracking-tight">AI Meeting Companion</span>
        </Link>

        {status === "checking" && (
          <div role="status" className="flex flex-col items-center gap-3 py-8 text-sm">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="text-muted-foreground">Checking your reset link…</span>
          </div>
        )}

        {status === "invalid" && (
          <div className="space-y-4 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-destructive/15 text-destructive">
              <Link2Off className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-bold">
              {reason === "expired" ? "This link has expired" : "This link isn't valid"}
            </h1>
            <p className="text-sm text-muted-foreground">
              Password reset links work once and expire after a short time. Request a new one and
              open it in this browser.
            </p>
            <Button asChild variant="brand" className="w-full">
              <Link to="/auth" search={{ mode: "forgot" }}>
                Request a new link
              </Link>
            </Button>
          </div>
        )}

        {status === "ready" && (
          <>
            <div className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" />
              <h1 className="text-2xl font-bold">Set a new password</h1>
            </div>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>New password</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          autoComplete="new-password"
                          className="glass"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm new password</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          autoComplete="new-password"
                          className="glass"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  variant="brand"
                  className="w-full"
                  disabled={form.formState.isSubmitting}
                >
                  {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
                  Update password
                </Button>
              </form>
            </Form>
          </>
        )}
      </div>
    </div>
  );
}
