import { createContext } from "react";
import type { Session } from "@supabase/supabase-js";

export interface AuthState {
  session: Session | null;
  /** True until the initial session has been read from storage. */
  loading: boolean;
}

export const AuthContext = createContext<AuthState | null>(null);
