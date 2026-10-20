/** Google sign-in and Google Calendar import. Off unless VITE_ENABLE_GOOGLE is "true"; see docs/GOOGLE_SETUP.md. */
export const GOOGLE_ENABLED = import.meta.env.VITE_ENABLE_GOOGLE === "true";
