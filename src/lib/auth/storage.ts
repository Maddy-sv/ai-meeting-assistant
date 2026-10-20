/**
 * Small browser-storage helpers used by the auth flow. Every access is guarded
 * because storage can be unavailable (SSR, private mode, blocked site data).
 */
import { supabase } from "@/integrations/supabase/client";

const RECOVERY_KEY = "auth_recovery_at";
const POST_AUTH_REDIRECT_KEY = "auth_post_redirect";
/** A recovery link is honoured for one hour in the tab that opened it. */
const RECOVERY_TTL_MS = 60 * 60 * 1000;

function session(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Remember that this tab arrived through a password-recovery link. */
export function markRecoverySession() {
  session()?.setItem(RECOVERY_KEY, String(Date.now()));
}

/** True when this tab received a PASSWORD_RECOVERY event within the last hour. */
export function hasRecoverySession(): boolean {
  const raw = session()?.getItem(RECOVERY_KEY);
  if (!raw) return false;
  return Date.now() - Number(raw) < RECOVERY_TTL_MS;
}

export function clearRecoverySession() {
  session()?.removeItem(RECOVERY_KEY);
}

/**
 * Returns `value` only if it is a same-origin relative path (starts with a single "/"),
 * otherwise `fallback`. Prevents open redirects through `?redirect=`.
 */
export function safeRedirect(value: unknown, fallback = "/dashboard"): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (value.startsWith("/auth") || value.startsWith("/reset-password")) return fallback;
  return value;
}

/** Store where to go after an OAuth round-trip (the provider returns to the site root). */
export function rememberPostAuthRedirect(path: string) {
  session()?.setItem(POST_AUTH_REDIRECT_KEY, safeRedirect(path));
}

/** Read and forget the post-OAuth destination, if any. */
export function consumePostAuthRedirect(): string | null {
  const store = session();
  const value = store?.getItem(POST_AUTH_REDIRECT_KEY) ?? null;
  store?.removeItem(POST_AUTH_REDIRECT_KEY);
  return value ? safeRedirect(value) : null;
}

/** Remove app caches kept in localStorage (all keys starting with "ai_") and auth hints. */
export function clearLocalAppData() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("ai_")) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Storage unavailable: nothing to clear.
  }
  clearRecoverySession();
  session()?.removeItem(POST_AUTH_REDIRECT_KEY);
}

// Supabase emits PASSWORD_RECOVERY once, while it parses the recovery link during client
// start-up — possibly before any React effect has subscribed. Listening at module load
// (this module is imported by the root route) makes sure the event is never missed.
if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") markRecoverySession();
  });
}
