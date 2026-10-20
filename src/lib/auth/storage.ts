import { supabase } from "@/integrations/supabase/client";

const RECOVERY_KEY = "auth_recovery_at";
const POST_AUTH_REDIRECT_KEY = "auth_post_redirect";

const RECOVERY_TTL_MS = 60 * 60 * 1000;

function session(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function markRecoverySession() {
  session()?.setItem(RECOVERY_KEY, String(Date.now()));
}

export function hasRecoverySession(): boolean {
  const raw = session()?.getItem(RECOVERY_KEY);
  if (!raw) return false;
  return Date.now() - Number(raw) < RECOVERY_TTL_MS;
}

export function clearRecoverySession() {
  session()?.removeItem(RECOVERY_KEY);
}

export function safeRedirect(value: unknown, fallback = "/dashboard"): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (value.startsWith("/auth") || value.startsWith("/reset-password")) return fallback;
  return value;
}

export function rememberPostAuthRedirect(path: string) {
  session()?.setItem(POST_AUTH_REDIRECT_KEY, safeRedirect(path));
}

export function consumePostAuthRedirect(): string | null {
  const store = session();
  const value = store?.getItem(POST_AUTH_REDIRECT_KEY) ?? null;
  store?.removeItem(POST_AUTH_REDIRECT_KEY);
  return value ? safeRedirect(value) : null;
}

export function clearLocalAppData() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("ai_")) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {}
  clearRecoverySession();
  session()?.removeItem(POST_AUTH_REDIRECT_KEY);
}

if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") markRecoverySession();
  });
}
