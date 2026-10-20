import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, Loader2, MailCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { AuthError } from "@supabase/supabase-js";
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
import { supabase } from "@/integrations/supabase/client";
import { GOOGLE_ENABLED } from "@/lib/features";
import { rememberPostAuthRedirect, safeRedirect, useSession } from "@/lib/auth";

type Mode = "signin" | "signup" | "forgot" | "check-email";

interface AuthSearch {
  redirect?: string;
  mode?: "signin" | "signup" | "forgot";
}

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>): AuthSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
    mode:
      search.mode === "signup" || search.mode === "forgot" || search.mode === "signin"
        ? search.mode
        : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign in — AI Powered Meeting Companion" },
      {
        name: "description",
        content: "Sign in to AI Powered Meeting Companion and let AI handle your meeting notes.",
      },
    ],
  }),
  component: AuthPage,
});

const emailField = z.string().trim().min(1, "Enter your email").email("Enter a valid email");
const newPasswordField = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(72, "Use at most 72 characters");

const signInSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Enter your password"),
});
const signUpSchema = z
  .object({
    name: z.string().trim().min(1, "Enter your name").max(100, "Name is too long"),
    email: emailField,
    password: newPasswordField,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });
const forgotSchema = z.object({ email: emailField });

function emailRedirectUrl() {
  return `${window.location.origin}/auth`;
}

function authErrorMessage(error: AuthError | Error, fallback: string): string {
  const code = "code" in error ? error.code : undefined;
  const status = "status" in error ? error.status : undefined;
  if (status === 429 || code?.startsWith("over_")) {
    return "Too many attempts. Please wait a minute and try again.";
  }
  if (code === "weak_password") {
    return "That password is too weak or has appeared in a data breach. Please choose another.";
  }
  return fallback;
}

function AuthPage() {
  const router = useRouter();
  const search = Route.useSearch();
  const { session, loading } = useSession();
  const redirectTo = safeRedirect(search.redirect);
  const [mode, setMode] = useState<Mode>(search.mode ?? "signin");
  const [pendingEmail, setPendingEmail] = useState("");

  useEffect(() => {
    if (!loading && session && mode !== "check-email") {
      router.history.replace(redirectTo);
    }
  }, [loading, session, mode, redirectTo, router]);

  function showCheckEmail(email: string) {
    setPendingEmail(email);
    setMode("check-email");
  }

  const heading: Record<Mode, { title: string; subtitle: string }> = {
    signin: {
      title: "Welcome back",
      subtitle: "Sign in to your AI Powered Meeting Companion workspace",
    },
    signup: { title: "Create your account", subtitle: "Start automating your meetings" },
    forgot: { title: "Reset your password", subtitle: "We'll email you a secure reset link" },
    "check-email": { title: "Check your email", subtitle: "One more step to finish" },
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2">
          <div className="gradient-bg grid h-10 w-10 place-items-center rounded-xl shadow-glow">
            <Sparkles className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-bold tracking-tight">AI Powered Meeting Companion</span>
        </Link>

        <div className="glass rounded-3xl p-6 shadow-soft sm:p-8">
          <h1 className="text-2xl font-bold">{heading[mode].title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{heading[mode].subtitle}</p>

          {GOOGLE_ENABLED && (mode === "signin" || mode === "signup") && (
            <>
              <GoogleButton redirectTo={redirectTo} />
              <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" /> or{" "}
                <div className="h-px flex-1 bg-border" />
              </div>
            </>
          )}

          {mode === "signin" && <SignInForm onNeedsConfirmation={showCheckEmail} />}
          {mode === "signup" && <SignUpForm onCheckEmail={showCheckEmail} />}
          {mode === "forgot" && <ForgotForm onDone={() => setMode("signin")} />}
          {mode === "check-email" && <CheckEmail email={pendingEmail} />}

          <div className="mt-6 flex flex-wrap justify-between gap-2 text-sm">
            {mode === "signin" ? (
              <>
                <Button
                  variant="link"
                  className="h-auto p-0 text-muted-foreground"
                  onClick={() => setMode("forgot")}
                >
                  Forgot password?
                </Button>
                <Button variant="link" className="h-auto p-0" onClick={() => setMode("signup")}>
                  Create an account
                </Button>
              </>
            ) : (
              <Button
                variant="link"
                className="h-auto p-0 text-muted-foreground"
                onClick={() => setMode("signin")}
              >
                <ArrowLeft /> Back to sign in
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SignInForm({ onNeedsConfirmation }: { onNeedsConfirmation: (email: string) => void }) {
  const form = useForm<z.infer<typeof signInSchema>>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: z.infer<typeof signInSchema>) {
    const { error } = await supabase.auth.signInWithPassword(values);
    if (!error) return;
    if (error.code === "email_not_confirmed") {
      toast.info("Please confirm your email address first.");
      onNeedsConfirmation(values.email);
      return;
    }
    toast.error(authErrorMessage(error, "Incorrect email or password."));
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" className="glass" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="current-password"
                  className="glass"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <SubmitButton pending={form.formState.isSubmitting}>Sign in</SubmitButton>
      </form>
    </Form>
  );
}

function SignUpForm({ onCheckEmail }: { onCheckEmail: (email: string) => void }) {
  const form = useForm<z.infer<typeof signUpSchema>>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });

  async function onSubmit(values: z.infer<typeof signUpSchema>) {
    const { data, error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: { data: { full_name: values.name }, emailRedirectTo: emailRedirectUrl() },
    });
    if (error) {
      toast.error(
        authErrorMessage(
          error,
          "We couldn't create that account. If you already have one, sign in or reset your password.",
        ),
      );
      return;
    }

    if (!data.session) onCheckEmail(values.email);
    else toast.success("Welcome! Your account is ready.");
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Full name</FormLabel>
              <FormControl>
                <Input autoComplete="name" className="glass" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" className="glass" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" className="glass" {...field} />
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
              <FormLabel>Confirm password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" className="glass" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <p className="text-xs text-muted-foreground">At least 8 characters.</p>
        <SubmitButton pending={form.formState.isSubmitting}>Create account</SubmitButton>
      </form>
    </Form>
  );
}

function ForgotForm({ onDone }: { onDone: () => void }) {
  const form = useForm<z.infer<typeof forgotSchema>>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit({ email }: z.infer<typeof forgotSchema>) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error && (error.status === 429 || error.code?.startsWith("over_"))) {
      toast.error(authErrorMessage(error, ""));
      return;
    }

    toast.success("If an account exists for that email, a reset link is on its way.");
    onDone();
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" className="glass" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <SubmitButton pending={form.formState.isSubmitting}>Send reset link</SubmitButton>
      </form>
    </Form>
  );
}

const RESEND_COOLDOWN_S = 60;

function CheckEmail({ email }: { email: string }) {
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function resend() {
    setSending(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: emailRedirectUrl() },
    });
    setSending(false);
    if (error && (error.status === 429 || error.code?.startsWith("over_"))) {
      toast.error(authErrorMessage(error, ""));
      return;
    }
    toast.success("If that address is waiting for confirmation, we've sent a new email.");
    setCooldown(RESEND_COOLDOWN_S);
  }

  return (
    <div className="mt-6 space-y-4 text-sm">
      <div className="flex items-start gap-3 rounded-2xl bg-primary/10 p-4">
        <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <p>
          We sent a confirmation link to <span className="font-semibold break-all">{email}</span>.
          Open it to activate your account, then you'll be signed in automatically.
        </p>
      </div>
      <p className="text-muted-foreground">
        Can't find it? Check your spam folder, or request another email.
      </p>
      <Button
        variant="glass"
        className="w-full"
        onClick={resend}
        disabled={sending || cooldown > 0 || !email}
      >
        {sending && <Loader2 className="animate-spin" />}
        {cooldown > 0 ? `Resend available in ${cooldown}s` : "Resend confirmation email"}
      </Button>
    </div>
  );
}

function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <Button type="submit" variant="brand" className="mt-2 w-full" disabled={pending}>
      {pending && <Loader2 className="animate-spin" />}
      {pending ? "Please wait…" : children}
    </Button>
  );
}

function GoogleButton({ redirectTo }: { redirectTo: string }) {
  const [pending, setPending] = useState(false);

  async function signIn() {
    setPending(true);
    rememberPostAuthRedirect(redirectTo);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth` },
      });
      if (error) {
        console.error("[auth] Google sign-in failed", error);
        toast.error("Google sign-in failed. Please try again.");
      }
    } catch (error) {
      console.error("[auth] Google sign-in failed", error);
      toast.error("Google sign-in failed. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button variant="glass" className="mt-6 w-full" onClick={signIn} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <GoogleIcon />}
      Continue with Google
    </Button>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" fill="currentColor">
      <path d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35.5 24 35.5c-6.4 0-11.5-5.1-11.5-11.5S17.6 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.9 6.6 29.2 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.4-.3-3.5z" />
    </svg>
  );
}
