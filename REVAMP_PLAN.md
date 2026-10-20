# REVAMP_PLAN.md — AI Powered Meeting Companion

**Audit date:** 2026-10-20 · **Audited ref:** `main` @ `7f07084` (in sync with `origin/main`) + uncommitted working tree
**Scope:** planning and audit only. No application code, configuration, dependencies or Git state were modified while producing this document.

### Evidence legend
| Tag | Meaning |
|---|---|
| **[V]** | Verified: read in source/SQL or reproduced by a local command during this audit |
| **[S]** | Suspected: strongly implied by code, but depends on runtime/deploy state not observed |
| **[U]** | Unverified: requires credentials or access to external services (Supabase dashboard, Google, Resend, Lovable) |

Line numbers refer to the **working tree** (including uncommitted changes) unless stated as `HEAD`.

---

## 1. Executive summary

The product is a dark "glass"-styled AI meeting companion. It records live transcripts in the browser, summarises them with Gemini, extracts action items and decisions, and offers a to-do board, a calendar with Google Calendar import, projects with cross-meeting summaries, and an AI chat. It was scaffolded on Lovable (TanStack Start + Supabase) and then extended by hand.

**Current state: not production-ready.** There are six blocking groups of issues:

1. **Leaked secret in a PUBLIC repo** [V]. `.env` is tracked by Git. `GEMINI_API_KEY` was committed in `72cfbb9`, which is pushed to `github.com/Maddy-sv/ai-meeting-assistant` (visibility: PUBLIC). The working-tree key differs from HEAD, but the old key must be treated as compromised until it is revoked.
2. **Authentication bypass on server functions** [V]. `src/integrations/supabase/auth-middleware.ts:69-102` accepts any three-part token and reads `sub` without verifying the signature or expiry. Database calls are still protected by RLS, because PostgREST rejects forged tokens. Gemini calls that happen before any DB access are not protected (`transcribeRemoteAudio`, `askChatBot`). The result is an unauthenticated Gemini proxy billed to the project.
3. **Cross-tenant data access through RLS** [V]. In `supabase/migrations/20260820184527_todo_rls.sql:1-11`, `assignee ILIKE '%' || full_name || '%'` is the access rule. A user can set `full_name = ''` in Profile, after which the pattern is `'%%'` and they can **read and update every user's action items**.
4. **Fabricated data written to the production DB** [V]. When a completed meeting has no transcript, `meetings.$id.tsx` `load()` (~683-1311) inserts a scripted transcript naming specific people. It also renames participants to "Shreyash" based on title keywords (807-845), and invents action items, summaries and decisions (~873-1296). `todo.tsx` (~400-520), `ai.functions.ts` (531-600, 828) and `continuous-memory.ts` (16-19, 115, 256) contain the same kind of scenario-specific logic. HEAD limited the transcript injection to one hard-coded meeting UUID; **the uncommitted diff removes that guard**, so it now applies to every user.
5. **Data loss and integrity bugs** [V]. Action-item IDs come from `getStableTaskId()`. It produces non-UUID strings, and four *global* fixed UUIDs, for a UUID primary key. Writes are delete-then-insert, and insert errors are ignored. Several server functions report `success: true` on failure, and one fabricates a task.
6. **The build is not type-safe, and admin is unprotected** [V]. `tsc` reports 65 errors. Lint reports 2,402 problems. `meetings.$id.tsx:1817` references an undefined `meetingData`, which is a ReferenceError at runtime. The `/admin/*` routes have no role guard and show mock data.

Strengths worth keeping:
- RLS is enabled on every table, and role escalation through signup metadata is blocked by the trigger.
- AI calls run server-side only.
- The visual identity is coherent.
- Error and 404 pages are on-brand.
- `npm run build` and `npm test` pass.

**Recommendation:**
- Do not commit the uncommitted work to `main` as-is.
- Rotate the key immediately; this is the only time-critical action.
- Then proceed through the phases in §9. Security and data integrity come first, then features, structure, the design system, tests and release.

---

## 2. Verified architecture

```
Browser (React 19, TanStack Router, ssr:false for /_authenticated)
 ├── supabase-js (publishable key, session in localStorage) ──► Supabase PostgREST / Auth / Realtime   (RLS is the only guard)
 ├── TanStack server functions (src/lib/ai.functions.ts, 11 fns)
 │     └─ requireSupabaseAuth middleware (auth-middleware.ts) → user-scoped supabase client + Gemini (@google/genai, GEMINI_API_KEY)
 ├── fetch → Supabase Edge Function send-confirmation (hard-coded URL, calendar.tsx:168) → Resend
 ├── Google Calendar REST with session.provider_token (calendar.tsx:67-93)
 └── Web Speech API + getDisplayMedia/MediaRecorder (meetings.$id.tsx:1364-1673)
Edge Functions (Deno): send-confirmation (used), send-reminders (no caller, no cron), project-summary (hello-world boilerplate)
Deploy: Lovable → @lovable.dev/vite-tanstack-config → nitro → Cloudflare Workers (.wrangler/deploy/config.json → .output/server/wrangler.json)
```

| Concern | Finding | Evidence |
|---|---|---|
| Routing | File-based TanStack Router; `_authenticated` layout uses a client-side `beforeLoad` `getUser()` gate | `src/routes/_authenticated/route.tsx:6-11` [V] |
| Server/client boundary | `start.ts:22` attaches a bearer token globally; `*.functions.ts` handlers run on the server | `auth-attacher.ts:9-12` [V] |
| Service role | `client.server.ts` reads `SUPABASE_SERVICE_ROLE_KEY` but is imported nowhere | grep [V] |
| State | Local `useState` per route (about 60 `useState` in `meetings.$id.tsx`); React Query is installed but not used for data; localStorage caches; BroadcastChannel | [V] |
| Authorization | RLS in Postgres; `has_role()` SECURITY DEFINER; admin UI not enforced | migrations m1/m2 [V] |
| Error reporting | SSR wrapper `server.ts`, `error-capture.ts`, `lovable-error-reporting.ts` (`window.__lovableEvents`) | [V] |
| Supabase project | `.env`, `supabase/.temp/project-ref` and `calendar.tsx:168` use ref `aasrwv…`, but `supabase/config.toml:1` uses `spomto…`: **mismatch** | [V] |

---

## 3. Repository structure and technology stack

```
src/
  routes/            15 route files (index, auth, reset-password, _authenticated/{admin.*×4, calendar, chat, dashboard,
                     user.dashboard, meetings.index, meetings.$id, profile, projects/{index,$id}, todo, route})
  components/        app-shell.tsx + ui/ (46 shadcn components; ~33 unused)
  integrations/      supabase/{client, client.server, auth-middleware, auth-attacher, types}, lovable/index.ts (unused)
  lib/               ai.functions.ts (1284 LOC), continuous-memory.ts (620, untracked), mock-data.ts, error-*, utils
supabase/            config.toml, migrations/ (4), functions/ (3), .temp/ (CLI cache — tracked, should not be)
repo root            9 scratch scripts (test-*.ts, test-transcript.js, patch_ai.ts, parse_error.ts) — tracked, unused
paper_revision/      untracked research-paper .docx tooling (Python, __pycache__) — unrelated to the app
```

**Largest files:** `meetings.$id.tsx` 3,777 · `todo.tsx` 1,566 · `ai.functions.ts` 1,284 · `continuous-memory.ts` 620 · `calendar.tsx` 358.

| Layer | Technology (declared version) |
|---|---|
| Framework | TanStack Start ^1.168.26, TanStack Router ^1.170.16, React ^19.2, Vite ^8 |
| Build/deploy | `@lovable.dev/vite-tanstack-config` 2.13.1, nitro 3.0 beta, Cloudflare Workers |
| UI | Tailwind v4 (`@theme inline`, oklch tokens), shadcn/ui new-york (Radix), lucide-react, sonner |
| Data/Auth | `@supabase/supabase-js` ^2.110, Supabase Postgres + RLS, Edge Functions (Deno std 0.168, supabase-js 2.39 via esm.sh) |
| AI | `@google/genai` ^2.18 (Gemini; model IDs hard-coded) |
| Email | Resend (sandbox sender `onboarding@resend.dev`) |
| Tooling | TypeScript ^5.8 strict, ESLint 9 + prettier, `node --test` with strip-types (Node v24.18.0 locally) |
| Package manager | **Ambiguous.** `bun.lock` is stale (no `@google/genai`) and `bunfig.toml` is present, but bun is not installed locally. `package-lock.json` matches `package.json`. [V] |

---

## 4. Feature-completion matrix

| # | Feature | Status | Evidence | Missing work | Dependencies | Acceptance criteria |
|---|---|---|---|---|---|---|
| F1 | Landing page | Implemented (static), with placeholders | `index.tsx:92` "Watch Demo" has no handler; footer `href="#"` at :270-274 | Real targets, or remove the links | Copy and legal decisions | Every CTA and link resolves; no `href="#"` |
| F2 | Email/password auth | Implemented | `auth.tsx:50-65` | Always shows "You're signed in" even when email confirmation is pending (:55); 6-character minimum password (:134) | Supabase Auth settings [U] | Signup message reflects the confirmation state; password policy matches the Supabase config |
| F3 | Google sign-in (README) | **Missing** | No `signInWithOAuth`; `integrations/lovable/index.ts` is never imported | Decide: Supabase Google OAuth or Lovable auth | Google OAuth client [U] | User can sign in with Google end to end |
| F4 | "Admin" signup/login toggle | Broken / misleading | `auth.tsx:52` sends `role:"admin"`; trigger forces `'user'` (m1:161) | Remove the toggle; provision admins out-of-band | Decision D3 | No self-service admin UI |
| F5 | Password reset | Partial | `reset-password.tsx:20-31`: empty effect, no `PASSWORD_RECOVERY` check | Require a recovery session; handle expired links | — | Expired or invalid link shows an error; a normal session cannot reach the form |
| F6 | User dashboard | Partial | `user.dashboard.tsx`: "Join Room" has no handler (:127); notifications hard-coded `"0"` (:171); "Meetings Today" is wrong (:168); "Summary Ready" always shown (:148); greeting always "Good Morning" (:63); loading state never rendered; no host filter (:34) | Real stats, working links, skeleton | — | Every stat traceable to a query; Join opens `meeting_link` |
| F7 | Admin dashboard / users / meetings / AI | **Mocked** | `admin.dashboard.tsx:30-50` (hard-coded 142/89/1254 and a real personal email at :31); `admin.users.tsx:10-15`; `admin.meetings.tsx:10-16`; `admin.ai.tsx` fully static | Real admin API (service-role edge function) or removal | D3, service-role secret [U] | Non-admins redirected; data real or the page removed |
| F8 | Admin access control | **Broken** | No role guard on `/admin/*`; uncommitted diff removes admin nav but leaves the routes reachable | `beforeLoad` `has_role` guard plus server enforcement | — | Non-admin who opens `/admin/*` is redirected (tested) |
| F9 | Meetings list / create / delete / bulk delete | Implemented | `meetings.index.tsx:43-83` | Loading and error states; `AlertDialog` instead of `window.confirm` (:69, :77) | — | All three states rendered |
| F10 | Live transcription (mic, Web Speech) | Implemented (Chromium only) | `meetings.$id.tsx:1364-1479` | Browser support messaging | — | Unsupported browser shows a clear notice |
| F11 | Remote audio capture (screen/tab → Gemini) | Implemented, unsafe | `meetings.$id.tsx:1480-1673`; `ai.functions.ts:916-993` has no size limits | Validation, size caps, auth fix | Phase 1 | Oversize payload rejected with 413-equivalent |
| F12 | AI summary | Implemented, with **fabricated fallbacks** | `ai.functions.ts:102-410`; `meetings.$id.tsx` ~1150-1221 upserts an invented summary | Remove fabrication | — | Summary exists only if Gemini produced it from real transcript |
| F13 | Action items and decisions | **Broken** (working tree) | IDs from `continuous-memory.ts:15-19, 95-129` into a UUID PK (m1:108); delete-then-insert with ignored errors (`ai.functions.ts:377-399`, `605-645`); `meetings.$id.tsx:1817` ReferenceError | DB-generated IDs, transactional writes, error propagation | Phase 2 | Re-sync is idempotent; no silent loss; errors surface |
| F14 | To-do board | Partial / risky | `todo.tsx`: client deletes "duplicates" (:636-638); localStorage keys not per user (:84-101); seeded scenario tasks (~400-520); unused `fetchUserTodoTasks` import | DB as the source of truth; remove seeding | F2 RLS fix | No client-side heuristic deletes; cache keyed per user and cleared on sign-out |
| F15 | Calendar + Google Calendar import | Partial | `calendar.tsx:64-130`: `provider_token` is only present right after OAuth; `meetings.google_event_id` used (:105, :113) but **not in any migration** | Token persistence/refresh server-side; migration for the column | Google OAuth [U] | Import works in a later session; schema reproducible from migrations |
| F16 | Schedule + confirmation email | Implemented, fragile | `calendar.tsx:154-188`, hard-coded URL :168; `send-confirmation` is an open relay | `supabase.functions.invoke`; harden the function | Resend domain [U] | Email goes only to the authenticated user; HTML escaped |
| F17 | Reminders | Partial | `send-reminders` exists; no cron or schedule in repo | Schedule (pg_cron / Scheduled Functions), auth, idempotency | Supabase plan [U] | Runs on schedule; never sends twice |
| F18 | Projects + cumulative summary | Partial | `projects/*`, `generateProjectSummary` (`ai.functions.ts:725-857`); prompts hard-code names | Remove scenario names; regenerate types | — | Works for any user's data |
| F19 | AI chat | Partial | `chat.tsx`, `askChatBot` (`ai.functions.ts:858-913`) puts the whole visible DB into the prompt | Context limits, scoping to own data, history | F1 auth fix | Context limited to the caller's own rows; size-capped |
| F20 | Notifications | **Missing** | Table exists (m1:147); Bell has no handler (`app-shell.tsx` ~137-149) | Implement or remove the Bell | D5 | No dead controls |
| F21 | Profile + integrations | Partial | `profile.tsx:135` hard-codes "Google Connected"; "Connect" has no handler (:154) | Real status or remove | F3 | Status reflects the identity linked in Supabase |
| F22 | Email follow-up | Implemented | Gmail compose / `mailto:` (`meetings.$id.tsx:176`, ~3411); fabricated `@example.com` addresses (~3640, 3653) | Stop inventing addresses | — | Only real participant emails are offered |
| F23 | Semantic search / pre-meeting briefing (README) | **Missing** | No route or function | Scope decision | D5 | — |

---

## 5. Prioritized issue register

Severity reflects impact and exploitability in the current code.

| ID | Sev | Issue | Evidence | Impact | Remediation | Phase |
|---|---|---|---|---|---|---|
| S1 | **Critical** | Gemini API key committed to a PUBLIC repo; `.env` tracked | `git log -- .env` shows `72cfbb9` contains `GEMINI_API_KEY`; `gh repo view` says PUBLIC [V]. `.gitignore` has no `.env` rule | Quota and cost abuse on the key | Revoke the key in Google AI Studio now; `git rm --cached .env`; add `.env*` (keep `.env.example`) to `.gitignore`; history rewrite is optional (see D1) | 0 |
| S2 | **Critical** | Server-function middleware does not verify JWTs | `auth-middleware.ts:69-102` [V] | Unauthenticated callers can invoke Gemini-backed functions | Verify with `supabase.auth.getClaims(token)` / `auth.getUser(token)` (or JWKS); fail closed | 1 |
| S3 | **Critical** | `action_items` RLS uses wildcard `ILIKE` on a user-controlled `full_name` | `20260820184527_todo_rls.sql:1-11` [V] | Cross-tenant read and **update** of tasks; also leaks into chat context | Add `assignee_user_id uuid` FK, policy `= auth.uid()`; UPDATE limited to `status` (WITH CHECK + column grant/trigger) | 1 |
| D1 | **Critical** | Scenario-specific fabricated data written to the DB for any user | `meetings.$id.tsx` ~703-719, 803-850, 873-940, 1150-1296; `todo.tsx` ~400-520; `ai.functions.ts:531-600, 828`, prompts :258, :450; `continuous-memory.ts:16-19, 115, 256` [V] | Corrupts real users' meetings, tasks and participants; also stores real people's names | Delete all fabrication and name-specific branches; empty states instead | 2 |
| D2 | High | Action-item IDs: non-UUID strings and global fixed UUIDs | `continuous-memory.ts:15-19, 95-129` → `ai.functions.ts:382, 608` [V] | Inserts fail or collide; combined with D3, items are lost | DB-generated IDs; add a `canonical_key text` + unique `(meeting_id, canonical_key)` if dedupe is needed | 2 |
| D3 | High | Non-atomic delete-then-insert, insert errors ignored | `ai.functions.ts:227-228, 348-349, 377-399, 605-645, 1168-1169` [V] | Silent loss of transcripts, summaries, tasks | Postgres RPC in a transaction, or upsert; check every `error` | 2 |
| D4 | High | Server functions report success on failure; `createActionItemServer` fabricates a task | `ai.functions.ts:1190-1193, 1205-1208, 1255-1283`; `meetings.$id.tsx` ~1884-1888 [V] | UI shows saved data that does not exist | Throw typed errors; UI shows a toast and rolls back | 2 |
| B1 | High | ReferenceError: `meetingData` undefined in `handleSyncTasks` | `meetings.$id.tsx:1817` (TS2552) [V] | Fallback sync path always throws | Use the component-state meeting | 2 |
| B2 | High | 65 TypeScript errors; types drift from the schema | `tsc --noEmit`; `types.ts` lacks `projects`, `meetings.project_id`; `google_event_id` exists in types but in no migration [V] | Type safety lost; schema not reproducible | Add the missing migration, regenerate types, fix local interfaces, add `tsc` to CI | 2 |
| S4 | High | Admin routes have no guard | `route.tsx` checks login only; `admin.*.tsx` [V] | Any user sees the admin UI (mock data today) | `beforeLoad` `has_role(uid,'admin')`; any real admin data served by a server-side check | 1 |
| S5 | High | `send-confirmation` is an open email relay with HTML injection; CORS `*` | `send-confirmation/index.ts:9, 17-45, 55, 60` [V]; deployed `verify_jwt` unknown [U] | Spam/phishing from the project's sender once a real domain is configured | Verify JWT; recipient = auth user's email; escape HTML; validate `link` scheme; restrict CORS | 1 |
| S6 | High | `send-reminders` uses the service role with no caller auth; no schedule | `send-reminders/index.ts:5-9, 44, 71, 75` [V]; exposure depends on deploy [S] | Anyone can trigger mass reminder emails | Shared-secret header or service-role check; cron; idempotency column; escape HTML | 1 / 3 |
| S7 | High | No input validation or size limits on server functions | `.validator(d=>d)` at `ai.functions.ts:1067, 1183, 1198, 1236`; unbounded base64 at :104, :265, :918 [V] | Cost amplification, Worker memory or time limits, bad data | zod schemas (zod is already a dependency): `.uuid()`, enums, max lengths and bytes | 1 |
| S8 | High | Dependency vulnerabilities | `npm audit --omit=dev --package-lock-only`: 12 vulns (6 critical incl. `@tanstack/react-start`, `seroval`; 5 high) [V] | Known RPC deserialization issues | Upgrade TanStack Start/Router within the Lovable-compatible range; regenerate one lockfile | 1 |
| S9 | Medium | Prompt injection into prompts whose output is written to the DB | `ai.functions.ts:162-175, 242-261, 437-472, 957-977, 1035-1044, 1113-1126`; client-supplied `hostName` :966 [V] | Model can be steered to overwrite transcripts or participants | Delimit untrusted text; server-derived host name; user confirmation before destructive replace | 1 / 2 |
| S10 | Medium | Admin-scoped RLS lets admin-run sync and clean delete other users' rows, and the re-insert then fails | `ai.functions.ts:425-431, 670-677, 1074-1080` vs m1 policies [V] | Data loss when an admin opens another user's meeting | Explicit `host_id === userId` checks in every mutating function | 1 |
| Q1 | Medium | Hard-coded Gemini model IDs; `config.model` ignored; up to 12 attempts with no global deadline | `ai.functions.ts:13-21, 68, 178, 1129, 200-202` [V]; model names' validity [U] | Request timeouts on Workers; unclear model in use | Single `GEMINI_MODEL` env setting with fallback list; overall deadline | 2 |
| Q2 | Medium | Lint: 2,402 problems (2,271 prettier, 87 `no-explicit-any`, 17 `no-empty`, 12 `prefer-const`) | `npm run lint` [V] | Noise hides real issues | One formatting-only commit; then fix the remaining ~120 | 0 / 4 |
| Q3 | Medium | Oversized components (`meetings.$id.tsx` single component :212-3763) | `wc -l` [V] | Unmaintainable, untestable | Split per §9 Phase 4 | 4 |
| Q4 | Medium | localStorage caches not keyed per user, not cleared on sign-out | `todo.tsx:84-101, 247, 643`; `meetings.$id.tsx:48-56` [V] | Previous user's tasks on a shared device | Remove the caches (DB + Realtime is the source of truth) or key by uid and clear on `SIGNED_OUT` | 2 |
| Q5 | Medium | Supabase config mismatch and committed CLI cache | `config.toml:1` vs `.temp/project-ref`; `supabase/.temp/*` tracked [V] | Wrong project gets deployed function config | Fix `project_id`; untrack `.temp/` | 1 |
| Q6 | Medium | Client bundle chunk 557 kB (161 kB gzip); `inlineDynamicImports` warning | `npm run build` [V] | Slow first load | Lazy-load heavy routes and libraries | 5 |
| S11 | Low | `reset-password` usable from any session | `reset-password.tsx:20-31` [V] | Password change without re-auth | Require a `PASSWORD_RECOVERY` event or re-auth | 1 |
| S12 | Low | `has_role` executable by any authenticated user for any UUID | m2:9 [V] | Admin enumeration | Wrap in `is_admin()` that uses `auth.uid()` only | 1 |
| S13 | Low | `profiles.subscription_plan` user-updatable | m1:31, :39-40 [V] | Future plan bypass | Column-level privilege or trigger | 1 |
| S14 | Low | Hard-coded edge-function URL with project ref | `calendar.tsx:168` [V] | Breaks across environments | `supabase.functions.invoke` | 3 |
| S15 | Low | `window.open` without `noopener` | `meetings.$id.tsx` ~2366 [V] | Reverse tabnabbing | `noopener,noreferrer` | 4 |
| P1 | Low | Real personal email and names in mock/admin data and prompts | `admin.dashboard.tsx:31`, `admin.users.tsx:11`, and names across src (~109 hits) [V] | Privacy; unprofessional output | Remove | 2 |

---

## 6. Configuration, environment and integration inventory (no values)

### 6.1 Environment variables
| Name | Read at | Runtime | Purpose | Status |
|---|---|---|---|---|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` | `client.ts:33-34` | Client (build-time inlined) | Browser Supabase client | Required; public by design |
| `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` | `client.ts` SSR fallback, `auth-middleware.ts:36-37`, `client.server.ts:33` | Server | Per-request RLS client | Required |
| `SUPABASE_SERVICE_ROLE_KEY` | `client.server.ts:34` | Server | Admin client | Unused today; needed only if admin features become real. **Never** `VITE_`-prefixed |
| `GEMINI_API_KEY` | `ai.functions.ts:112, 421, 733, 866, 926, 1070` | Server | Gemini | Required; **rotate** (S1) |
| `SUPABASE_PROJECT_ID` / `VITE_SUPABASE_PROJECT_ID` | not read in `src/` | — | Lovable metadata | Keep only if Lovable needs it [U] |
| `RESEND_API_KEY` | `send-confirmation:3`, `send-reminders:3` | Edge secret | Email | Required for email [U] |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (edge) | `send-reminders:4-5` | Edge (auto-injected) | Reminder job | Platform-provided |
| *Proposed* `GEMINI_MODEL` | — | Server | Replace hard-coded model IDs (Q1) | New |
| *Proposed* `REMINDERS_CRON_SECRET` | — | Edge secret | Authenticate scheduled reminder calls (S6) | New |
| *Proposed* `EMAIL_FROM` | — | Edge secret/config | Replace `onboarding@resend.dev` | New, needs a verified domain [U] |

Deliverable in Phase 1: a committed **`.env.example`** containing names only, plus a README section describing where each one is set (local `.env`, Lovable/Cloudflare secrets, `supabase secrets set`).

### 6.2 External integrations and credentials (by service)
| Service | Purpose | Credential type | Where configured |
|---|---|---|---|
| Supabase | DB, Auth, Realtime, Edge Functions | Publishable key (public), service role (secret) | Lovable Cloud / Supabase dashboard [U] |
| Google AI (Gemini) | Summaries, transcription, chat | API key (secret) | Server env |
| Google OAuth / Calendar API | Calendar import (`calendar.readonly`) | OAuth client ID/secret | Supabase Auth provider settings [U] |
| Resend | Confirmation and reminder emails | API key (secret), verified sender domain | Supabase edge secrets [U] |
| Lovable | Hosting/sync, error events, optional cloud auth | Platform-managed | Lovable project [U] |
| Cloudflare Workers | Runtime target via nitro | Platform-managed | Lovable deploy [U] |

### 6.3 Hard-coded values to externalise or remove
| Category | Location | Action |
|---|---|---|
| Project refs | `calendar.tsx:168`; `config.toml:1` (mismatched) | `functions.invoke`; correct `project_id` |
| Gemini models | `ai.functions.ts:13-18, 178, 1129` | `GEMINI_MODEL` + a single constant |
| Scenario names (Sumeet Made, Shreyash, Matthew Smith, Marcus Reed, Priya Shah) | `meetings.$id.tsx`, `todo.tsx`, `ai.functions.ts`, `continuous-memory.ts` (~109 hits) | Delete (D1) |
| Fixed dates `2026-10-20/21/23` | `ai.functions.ts:531-533`; `meetings.$id.tsx:876-878, 1818-1820` | Delete; use `null` when a deadline is unresolved |
| Fixed task UUIDs | `continuous-memory.ts:16-19` | Delete (D2) |
| Hard-coded meeting UUID (HEAD) | `HEAD:meetings.$id.tsx` transcript-injection guard | Removed along with D1 |
| Personal/placeholder emails | `admin.dashboard.tsx:31-33`, `admin.users.tsx:11-15`, `mock-data.ts:44-46`, `meetings.$id.tsx` ~2802/3475/3624/3640/3653, `index.tsx:272` (`hello@zeta.ai`) | Remove or replace with configured contact (D6) |
| Sender `onboarding@resend.dev` | `send-confirmation:28`, `send-reminders:63` | `EMAIL_FROM` |
| Admin stats 142/89/1254 | `admin.dashboard.tsx:44-48` | Real queries or remove |
| Magic numbers (12 s timeout, 1.5 s × 3 retry, 15 s fake `spoken_at` spacing, `slice(-2)`, `slice(0,500)`) | `ai.functions.ts:68, 201, 224, 265, 338, 1165` | Named constants; the fake timestamps are removed |
| Old Deno deps (`std@0.168.0`, `supabase-js@2.39.0`) | edge functions | Upgrade to `jsr:`/`npm:` specifiers |

---

## 7. UI/UX and design-system audit

### 7.1 Current identity (preserve)
- Dark "glass" AI workspace on a deep indigo-black ground (`oklch(0.16 0.03 275)`).
- Purple primary `oklch(0.68 0.19 285)` and a purple-to-blue `--gradient-brand`.
- Translucent cards with 8% white borders and a purple glow shadow.
- Pill-shaped CTAs, `font-black tracking-tight` headings, the Sparkles logomark and lucide icons.
- Source: `src/styles.css` (Tailwind v4 `@theme inline`).

### 7.2 Findings
| Area | Finding | Evidence |
|---|---|---|
| Theming | Dark-only. A `.dark` variant is declared but never applied; no `color-scheme`; Sonner not given `theme="dark"` | `styles.css`, `__root.tsx:120` [V] |
| Token bypass | `meetings.$id.tsx`: 222 palette classes and 64 hex values, including a WhatsApp-style transcript (`#0c1317`, `#005c4b`, `#202c33`, `#53bdeb` at ~2496-2731). `todo.tsx`: 100 palette classes, 7 hex. `calendar.tsx`: `#09090b`. `auth.tsx` admin mode uses a separate zinc/red theme | [V] |
| Missing tokens | `--success-foreground`, `--warning-foreground`, `--info`, `--chart-1..5`, status and surface tokens; `success`/`warning` defined but largely unused; undefined `custom-scrollbar` class (`calendar.tsx:289`) | [V] |
| Typography | Inter is named but not loaded; page titles vary from 2xl to 4xl; `text-[10px]` ×29 and `text-[11px]` ×16 | [V] |
| Component reuse | `Card` used 0 times vs 148 inline `glass`; `gradient-bg shadow-glow rounded-full` repeated ~60×; raw `<button>` (34 in meetings.$id), `<table>`, `<select>`; installed `Table`, `AlertDialog`, `Sheet`, `Tooltip`, `Skeleton`, `Form` unused | [V] |
| Forms | RHF + zod + `ui/form.tsx` installed but every form uses ad-hoc `useState`; ~20 labels without `htmlFor` | [V] |
| Accessibility | **Zero `aria-label`s** in routes and app-shell; clickable divs (calendar cells, todo cards); nested `<a><button>`; hover-only controls (`opacity-0 group-hover`) never shown on focus; admin inputs with `outline-none` and no focus ring; hand-rolled mobile drawer without focus trap or Escape; no `motion-reduce`; emoji used as icons | [V] |
| Responsive | Calendar 7-column grid has no mobile view; todo kanban has fixed `w-[350px]` columns and HTML5 DnD (no touch); chat uses `h-[calc(100vh-160px)]`; landing header can overflow at 375px; Bell button jumps position at `md`; admin search rows don't wrap. Files with **0** responsive prefixes: admin.meetings, admin.users, calendar, chat, auth | [V] |
| States | Missing loading: calendar, meetings.index, user.dashboard (state set but not rendered). Profile shows "Loading…" forever on error. Errors ignored: calendar, meetings.index, projects/index | [V] |
| Navigation | Brand name inconsistent ("AI Companion / Workspace" in `app-shell.tsx:69` vs "AI Powered Meeting Companion"); admin pages linked from nowhere after the uncommitted change | [V] |

### 7.3 Proposed design-system standard
**Tokens** (in `styles.css`, extending existing values; no rebrand):
- Apply the current palette under `.dark` on `<html>` with `color-scheme: dark`. A light palette is optional (D7).
- Semantic tokens:
  - `--success/-foreground`, `--warning/-foreground`, `--info` (= current `brand-2`), `--chart-1..5`.
  - Meeting status: `--status-live`, `--status-upcoming`, `--status-completed`.
  - Task status: `--status-pending`, `--status-in-progress`, `--status-done`.
  - `--admin`.
- Surfaces: `--surface-1` / `--surface-2`, replacing the hex backgrounds.
- `--font-sans`: load Inter (or keep the system stack) via a webfont with fallback.

**Scales:**
- Type:
  - Display `text-4xl/5xl font-black` (landing and greeting only).
  - Page title `text-3xl font-black tracking-tight`.
  - Section `text-lg font-semibold`.
  - Eyebrow `text-xs uppercase tracking-widest text-muted-foreground`.
  - Body `text-sm`; meta `text-xs` (the minimum).
- Spacing: page `space-y-8`, section `space-y-4`, card `p-5`/`p-6`.
- Radius: controls `rounded-full`, inputs `rounded-lg`, cards `rounded-2xl`, dialogs `rounded-3xl`.
- Shadow: only `shadow-soft` and `shadow-glow`.

**Component variants:**
- `Button`: `brand`, `glass` and `admin` variants, plus `icon-sm`; icon buttons always have an `aria-label`.
- `Badge`: `success`, `warning`, `info`, `live` and `admin` variants.
- `StatusBadge`: the single mapping from status to colour.
- `Card`: `glass` and `raised` variants.
- Glass defaults for `Input` and `Select`.
- `FormField`: label linked to its control.

**Layout primitives** (`src/components/layout/`):
- `PageHeader`, `Section`, `StatTile`
- `EmptyState` (pattern from `projects/index.tsx:110-120`), `ErrorState` (pattern from the `__root` error UI), `LoadingState`/`PageSkeleton`
- `ConfirmDialog` (replaces `window.confirm`)
- An `AppShell` mobile nav built on `Sheet`, with a role-aware `USER_NAV`/`ADMIN_NAV` config

**Rules:**
- No hex, `rgb()` or raw palette classes in routes. An ESLint `no-restricted-syntax` rule, or a grep in CI, enforces this.
- lucide icons only, with no emoji icons.
- Every async view renders loading, error and empty states.
- Forms use RHF + zod.

---

## 8. Security, testing, performance, accessibility, deployment and maintainability gaps

| Area | Gap | Can verify locally? |
|---|---|---|
| Security | S1–S15 above | Code-level yes. Deployed `verify_jwt`, secrets and live RLS need Supabase access [U] |
| Testing | One test file (`continuous-memory.test.ts`, 12 passing tests that encode scenario heuristics). No component, server-function, RLS or E2E tests. `tsc` is not part of build or CI | Yes |
| CI | No CI config in the repo (no `.github/workflows`) | Yes |
| Performance | 557 kB main client chunk; server `@google/genai` 845 kB; no route-level lazy loading of heavy dependencies; up to 12 Gemini retries per call | Build output yes; runtime perf needs deploy |
| Reliability | Silent error swallowing (D3, D4); no global request deadline; Realtime and BroadcastChannel plus localStorage give three sources of truth | Partly |
| Accessibility | §7.2; no automated a11y checks | Yes, once a tool is approved (D8) |
| Observability | Only `console.*` (58 warn/error) and Lovable error events; no structured server logs, no error tracking, no AI cost or usage metrics | Needs a provider decision (D9) |
| Deployment | Lovable syncs `main` (AGENTS.md: never rewrite pushed history). No staging environment documented. `config.toml` project mismatch. Edge functions deployed manually; no cron | [U] |
| Maintainability | Three files over 1,200 LOC; ~33 unused UI components; duplicated logic (status cache ×2, `normalizeAssignee` ×3, heuristic task extraction ×3, `Meeting` type ×7); two lockfiles | Yes |
| Docs | README describes unimplemented features (Google sign-in, semantic search, briefings); no env/setup/deploy docs | Yes |

### Checks runnable locally without credentials
`npx tsc --noEmit` · `npm run lint` · `npm test` · `npm run build` · `npm audit --omit=dev` · grep-based guards (hex colours, scenario names, `console.`).

### Checks that need credentials or setup
- Local Supabase (`supabase start`) for migrations and RLS tests: Docker is installed; **Supabase CLI is not** (decision D8).
- Live Gemini calls.
- Resend delivery.
- Google OAuth and Calendar.
- Deployed edge-function config.
- Lovable/Cloudflare deploy.

---

## 9. Cleanup and removal candidates

| Candidate | Evidence of non-use | Confidence | Regression considerations |
|---|---|---|---|
| Root scratch scripts: `test-check-transcripts.ts`, `test-gemini-audio.ts`, `test-insert.ts`, `test-list-models.ts`, `test-login-insert.ts`, `test-models.ts`, `test-transcript-error.ts`, `test-transcript-service.ts`, `test-transcript.js`, `patch_ai.ts`, `parse_error.ts` | Not imported, outside `tsconfig` include; `test-login-insert.ts:12` contains a hard-coded test password (redacted); `patch_ai.ts` rewrites source if re-run | High | None; they are linted today, so lint counts drop |
| `supabase/.temp/` (9 files) | Supabase CLI cache | High | Untrack and gitignore; the CLI recreates it |
| `supabase/functions/project-summary/` | Hello-world boilerplate, no caller | High | Also remove its `config.toml` block; may need `supabase functions delete` on the live project [U] |
| `src/lib/mock-data.ts` (keep `formatDuration`) | `seedIfEmpty` unused; `formatDuration` used by 3 routes | High | Move `formatDuration` to `lib/format.ts` first |
| `src/integrations/lovable/index.ts` + `@lovable.dev/cloud-auth-js` | Never imported | Medium | Lovable may regenerate them; depends on D2 |
| `src/integrations/supabase/client.server.ts` | Never imported | Medium | Keep if admin features become real (D3) |
| Unused shadcn components (~33: alert-dialog, aspect-ratio, avatar, breadcrumb, calendar, card, carousel, chart, collapsible, command, context-menu, drawer, form, hover-card, input-otp, menubar, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, separator, sheet, sidebar, skeleton, slider, switch, table, toggle, toggle-group, tooltip) + `use-mobile.tsx` | No importer outside `ui/` | High (for "unused") | **Do not delete yet.** Phase 5 adopts card, table, alert-dialog, sheet, skeleton, tooltip, form, avatar. Delete only the ones still unused after Phase 5 |
| Dependencies only used by deletable components: recharts, embla-carousel-react, input-otp, vaul, react-resizable-panels, cmdk, react-day-picker, and their Radix packages | Import scan | Medium | Remove after the Phase 5 adoption pass; re-run build |
| Stale lockfile (`bun.lock` or `package-lock.json`) | `bun.lock` lacks `@google/genai` | High | Keep the one Lovable uses (D4) |
| `fetchUserTodoTasks` import (`todo.tsx:5`); unused `continuous-memory` exports | grep | High | — |
| Route-file helper exports (`todo.tsx:82, 90, 105`) | react-refresh warnings | High | Move to `lib/` |
| `paper_revision/` (untracked) | Unrelated research-paper tooling | — | **Not ours to delete.** Move it outside the repo, or gitignore it (D10) |
| `.DS_Store` files | Untracked; not in a root ignore rule beyond `.DS_Store` (already ignored) | — | No action needed |

---

## 10. Git baseline and branch strategy

**Current state** [V]:
- `main` @ `7f07084` equals `origin/main`, and the repo is public and Lovable-synced.
- Modified, uncommitted: `.env`, `package.json`, `app-shell.tsx`, `ai.functions.ts`, `dashboard.tsx`, `meetings.$id.tsx`, `projects/$id.tsx`, `todo.tsx`.
- Untracked: `continuous-memory.ts`, `continuous-memory.test.ts`, `paper_revision/`.

**Commit-safety assessment of the uncommitted work: NOT safe to commit to `main` as-is.**
- `.env` holds a live secret.
- The modified files import the untracked `continuous-memory.ts`; committing them without it breaks the build.
- The diff widens the fabricated-data injection to all users (D1).
- It introduces ID collisions (D2) and a ReferenceError (B1).

Safely reusable pieces:
- the `package.json` `test` script;
- the `projects/$id.tsx` `whitespace-pre-line`;
- the Gemini key-missing message and the 12 s cleaning timeout;
- the admin-nav removal, but only together with an admin guard.

**Proposed plan (awaiting your approval; nothing done yet):**
1. **Baseline:** `7f07084` (current `main`, already pushed).
2. **Preserve WIP without publishing it:** create a *local-only* branch `wip/continuous-memory-snapshot` from `7f07084` with one commit. It contains the 7 modified source files, `package.json`, `continuous-memory.ts` and `continuous-memory.test.ts`.
   - It excludes `.env` and `paper_revision/`.
   - It is not pushed unless you ask. Pushing it would publish the scenario names to a public repo.
   - Alternative: `git stash push -u` with an explicit pathspec. A branch is more traceable.
3. **Revamp branch:** `revamp/production-readiness` from `7f07084`.
   - Selectively port the safe pieces listed above (`git checkout wip/... -- <path>` hunks, applied by hand).
   - Conventional, small commits, one concern each, e.g. `chore(git): untrack .env and supabase/.temp`, `fix(auth): verify JWT in server middleware`.
4. **Working-tree `.env`** stays on disk untouched. It is only removed from the index (`git rm --cached .env`) in the first revamp commit.
5. **No history rewrite** (AGENTS.md forbids it because of Lovable sync). Key rotation is the remedy (see D1).
6. Merge to `main` through a PR per phase or group of phases, so Lovable only ever sees working states.

---

## 11. Phased implementation roadmap

Common validation gate for every phase (all local, no credentials):
```bash
npx tsc --noEmit          # must not increase error count; 0 from Phase 2 onwards
npm run lint              # must not increase; 0 errors from Phase 4 onwards
npm test
npm run build
```

### Phase 0 — Git safety and baseline (½ day)
- **Objective:** contain the secret, preserve the WIP, and establish the branch and tooling baseline.
- **Files:** `.gitignore`, `.env` (untrack only), `supabase/.temp/*` (untrack), new `.env.example`, `package.json` (scripts only).
- **Tasks:**
  1. **You:** revoke the old Gemini key and confirm the current one is fresh (S1).
  2. Create the WIP snapshot branch and the revamp branch (§10).
  3. Add `.env`, `.env.*`, `!.env.example`, `supabase/.temp/`, `__pycache__/` to `.gitignore`; `git rm --cached .env supabase/.temp`.
  4. Add `.env.example` (names only).
  5. Add a `typecheck` script (`tsc --noEmit`) and exclude root scratch files from ESLint (deleting them happens in Phase 4).
  6. One formatting-only commit (`eslint --fix` for prettier, ~2,283 fixes) so later diffs are reviewable.
- **Dependencies:** your approval; key rotation (only you can do it).
- **Risks and rollback:**
  - Untracking `.env` may affect Lovable's env injection [U]. Confirm Lovable reads env from its own settings (D2).
  - Rollback: re-add `.env` as a separate commit, with no secrets in it.
- **Done when:**
  - `git ls-files | grep -E '^\.env$|supabase/\.temp'` returns nothing.
  - The old key is revoked (your confirmation).
  - `npm run lint` prettier errors are at 0.
  - Build and test still pass.

### Phase 1 — Critical security and configuration (2–3 days)
- **Objective:** close S2–S8, S10–S13 and Q5.
- **Files:** `src/integrations/supabase/auth-middleware.ts`; new migration `supabase/migrations/2026xxxx_security_hardening.sql`; `src/routes/_authenticated/admin.*.tsx` + new `src/routes/_authenticated/admin/route.tsx` (guard); `src/lib/ai.functions.ts` (zod validators, ownership checks); `supabase/functions/send-confirmation/index.ts`, `send-reminders/index.ts`; `supabase/config.toml`; `src/routes/reset-password.tsx`; `src/routes/auth.tsx` (remove the admin signup toggle); `package.json` + one lockfile.
- **Tasks:**
  1. JWT verification in the middleware (`supabase.auth.getClaims` or `getUser(token)`), failing closed. Unit test with forged, expired and valid tokens.
  2. Migration:
     - add `action_items.assignee_user_id uuid references auth.users`;
     - backfill `assignee_user_id` with exact matches only;
     - drop the two ILIKE policies;
     - add `= auth.uid()` SELECT and UPDATE policies with WITH CHECK, and restrict updates to `status` through a trigger;
     - add an `is_admin()` helper; revoke direct `has_role` execution from `authenticated`;
     - protect `profiles.subscription_plan` with a column-level privilege or trigger;
     - add the missing `meetings.google_event_id` column (`IF NOT EXISTS`) so the schema is reproducible.
  3. Admin `beforeLoad` guard using `is_admin()`.
  4. zod schemas on all 11 server functions, with uuid, enum and length/byte limits (e.g. audio ≤ 10 MB base64, `messages` ≤ 50). Add an explicit `host_id === userId` check on every mutating AI function.
  5. Edge functions:
     - `send-confirmation`: verify JWT, recipient = auth email, escape HTML, `https:` links only, restricted CORS;
     - `send-reminders`: require a `REMINDERS_CRON_SECRET` header.
  6. Fix the `config.toml` `project_id`.
  7. Upgrade `@tanstack/react-start` and the router to patched versions (check Lovable-config compatibility). Choose one lockfile (D4).
  8. `reset-password` requires a recovery session.
- **Dependencies:** Phase 0. Applying the migration to the live DB needs Supabase access [U]. Lovable-config compatibility for the upgrade.
- **Risks and rollback:**
  - The RLS change could hide tasks currently visible to assignees. The backfill report lists unmatched rows before policies are dropped.
  - Migration rollback: a down script restoring the old policies, kept in the PR description and not committed as live.
  - Dependency upgrade: revert the lockfile commit.
- **Validation:**
  - Common gate.
  - Middleware unit tests.
  - RLS tests (pgTAP or SQL scripts) against local Supabase if the CLI is approved (D8). Otherwise apply on a Supabase branch [U].
  - `npm audit --omit=dev` shows 0 critical.
- **Done when:**
  - A forged JWT gets 401 on every server function (test).
  - User B cannot select or update user A's action items with `full_name=''` (SQL test).
  - A non-admin hitting `/admin/*` is redirected.
  - `send-confirmation` rejects anonymous calls and arbitrary recipients.
  - 0 critical and 0 high prod vulnerabilities.

### Phase 1B — Authentication: complete and harden (3–4 days)
- **Objective:** make sign-in, sign-up, recovery, sessions, roles and server-side identity robust and complete. This is the area you flagged as remaining.
- **Current auth state** [V]:

  | Area | Today | Gap |
  |---|---|---|
  | Server identity | `auth-middleware.ts:69-102` decodes the JWT without verifying it | S2: forged tokens reach Gemini |
  | Route gate | `_authenticated/route.tsx:6-11`: client `getUser()` in `beforeLoad`, no `redirect` back-param | After login the user always lands on the dashboard; no reaction to session expiry mid-page |
  | Sign-up | `auth.tsx:50-65`, 6-char minimum (:134), always says "signed in" (:55) | Email-confirmation flow, password policy, abuse protection |
  | Google sign-in | Not implemented; `integrations/lovable/index.ts` unused | README feature missing |
  | Google Calendar | `linkIdentity` + `session.provider_token` read in the browser (`calendar.tsx:67-93`) | Token disappears after refresh or reload; no refresh token stored |
  | Password reset | `reset-password.tsx:20-31` with no recovery-session check | S11 |
  | Roles | "Admin" toggle on the login page; `has_role` callable for any UUID; `/admin/*` unguarded | S4, S12, F4 |
  | Sign-out | Per-user localStorage caches not cleared | Q4 |
  | Edge functions | `send-confirmation` trusts the body; `send-reminders` has no caller auth | S5, S6 |
  | Account lifecycle | No email change, account deletion or data export | UK GDPR expectations |

- **Tasks:**
  1. **Server:** verify every token with `supabase.auth.getClaims(token)` (asymmetric JWT signing keys) or `auth.getUser(token)`; reject expired tokens; type the context `{ userId, email, isAdmin }`; one shared `requireAdmin` middleware.
  2. **Client session layer** `src/lib/auth/`:
     - a single `AuthProvider` subscribing to `onAuthStateChange`;
     - `useSession()` / `useUser()` hooks replacing the four duplicated profile lookups;
     - on `SIGNED_OUT` or `TOKEN_REFRESHED` failure: clear the query cache and localStorage, then redirect;
     - `redirect` search param so users return where they started.
  3. **Sign-up and sign-in:**
     - RHF + zod forms;
     - minimum 8 characters and Supabase leaked-password protection [U];
     - correct "check your email" state when confirmation is on;
     - resend confirmation;
     - generic error messages (no account enumeration);
     - CAPTCHA (Turnstile/hCaptcha via Supabase Auth) [U];
     - remove the Admin/"Student" toggle.
  4. **Google OAuth:**
     - `signInWithOAuth({ provider: 'google' })` with the redirect URL allow-list;
     - Calendar consent requested incrementally;
     - `provider_refresh_token` stored server-side (encrypted table or Vault) so Calendar sync works across sessions;
     - Calendar API calls moved behind a server function.
  5. **Recovery:** handle the `PASSWORD_RECOVERY` event, show expired/invalid link states, sign out other sessions after a password change.
  6. **Roles:**
     - `is_admin()` SQL helper (uses `auth.uid()` only);
     - `/admin` layout route with a `beforeLoad` guard;
     - admins provisioned only by SQL or a service-role script, documented in the README;
     - optional TOTP MFA (Supabase MFA, AAL2) required for admin routes.
  7. **Account settings:** change email/password, sign out everywhere, delete account (an edge function using the service role, cascading deletes).
  8. **Edge-function auth:** as in Phase 1 S5/S6.
- **Files:** `src/integrations/supabase/auth-middleware.ts`, `src/routes/_authenticated/route.tsx`, new `src/routes/_authenticated/admin/route.tsx`, `src/routes/auth.tsx`, `src/routes/reset-password.tsx`, new `src/routes/auth.callback.tsx`, new `src/lib/auth/*`, `src/routes/_authenticated/profile.tsx`, `calendar.tsx`, new migration (`is_admin`, `user_oauth_tokens`, policies), new edge function `delete-account`.
- **Dependencies:** Phase 0. Google OAuth client and redirect URLs, CAPTCHA keys and leaked-password protection are all set in the Supabase/Google dashboards [U]. Who owns the Supabase project (§15) must be resolved before migrations go live.
- **Risks and rollback:** a wrong redirect allow-list can lock users out. Ship behind a staging check; each step is a separate commit and revertible. Existing sessions remain valid through the change.
- **Validation:**
  - Middleware unit tests: valid, forged, expired, missing token.
  - Route-guard tests: anonymous to `/auth?redirect=…`; non-admin to `/dashboard`.
  - Manual matrix on staging: sign-up with confirmation, sign-in, Google sign-in, reset (valid and expired link), sign-out clears caches, Calendar sync after a page reload.
- **Done when:**
  - Every row in the table above shows its gap closed, with a test or checklist evidence.
  - Supabase Auth security advisors are clean [U].

### Phase 2 — Data integrity: remove fabrication, fix persistence, restore type safety (3–4 days)
- **Objective:** close D1–D4, B1, B2, Q1, Q4 and P1. No data the user didn't produce is ever written.
- **Files:** `src/routes/_authenticated/meetings.$id.tsx`, `todo.tsx`; `src/lib/ai.functions.ts`; `src/lib/continuous-memory.ts` (ported from WIP only in generic form, or dropped; see D11); `src/integrations/supabase/types.ts` (regenerated); new migration for an atomic replace RPC (`replace_meeting_action_items(meeting_id, items jsonb)` etc.) and an optional `canonical_key`.
- **Tasks:**
  1. Delete every scripted transcript, participant rename, invented summary, decision and task, and every name/date literal (grep guard: `Sumeet|Shreyash|Matthew|Marcus|Priya|2026-10-2` must return 0 in `src/`).
  2. Action-item IDs generated by the DB; dedupe via a unique `(meeting_id, canonical_key)`.
  3. Replace delete-then-insert with transactional RPCs or upserts; propagate all Supabase errors as typed errors; the UI shows a toast and rolls back optimistic state.
  4. Remove fabricated "success" returns.
  5. Fix B1.
  6. Regenerate types (`supabase gen types` or the Supabase MCP `generate_typescript_types` [U]); replace local duplicate interfaces with `Tables<'meetings'>` etc.; reach **0 tsc errors**.
  7. `GEMINI_MODEL` env with one fallback; overall 25 s deadline; drop the ignored `config.model`.
  8. Remove the localStorage task caches (rely on DB + Realtime), or key them by uid and clear them on `SIGNED_OUT`.
- **Dependencies:** Phase 1 (RLS and schema). Type regeneration needs Supabase access or the local CLI [U].
- **Risks and rollback:**
  - Users who relied on the injected demo data will see empty states. This is intended; it needs your sign-off (D11).
  - Per-commit revert; RPC migrations get down scripts.
- **Validation:**
  - Common gate with `tsc` = 0.
  - Grep guards.
  - New `node --test` unit tests for pure helpers.
  - Server-function tests with a mocked Supabase client: insert error leads to a thrown error, and re-sync twice gives the same row count.
- **Done when:**
  - `tsc` reports 0 errors.
  - The fabrication grep returns 0.
  - Re-running summarise or sync is idempotent (test).
  - No server function returns success after a DB error (test).

### Phase 3 — Feature completion and integration gaps (3–5 days; scope depends on D3, D5)
- **Objective:** every visible control works or is removed.
- **Files:** `user.dashboard.tsx`, `dashboard.tsx` (convert to a `beforeLoad` redirect), `admin.*` (real or removed), `calendar.tsx`, `profile.tsx`, `index.tsx`, `app-shell.tsx`, `chat.tsx`, `auth.tsx`, `supabase/functions/send-reminders`, the cron migration (`pg_cron` + `pg_net`) or a scheduled function.
- **Tasks:**
  - Real dashboard stats; Join opens `meeting_link`; time-of-day greeting.
  - Admin: either an `admin-api` edge function using the service role behind `is_admin()`, or removal of the routes (D3).
  - Calendar: `functions.invoke`; graceful re-auth when `provider_token` is absent.
  - Reminders: schedule, idempotency (`reminder_sent_at`), per-user timezone.
  - Notifications Bell: implement it from the `notifications` table, or remove it (D5).
  - Profile: real connection status.
  - Landing: real links or removal.
  - Chat: scope and cap the context; optionally persist history.
  - Google sign-in if D2 requires it.
- **Dependencies:** Phases 1–2; Google, Resend and cron access [U].
- **Risks:** the scope can grow, so each feature is its own PR. Rollback by PR revert.
- **Validation:** the common gate plus manual checks against each acceptance criterion in §4.
- **Done when:** every row in §4 is Implemented or explicitly De-scoped, with grep showing no `href="#"` and no handler-less buttons.

### Phase 4 — Architecture, code quality and safe cleanup (3–4 days)
- **Objective:** maintainable modules; lint clean; remove dead weight.
- **Files and moves:**
  - `meetings.$id.tsx` (3,777 LOC) is split into:
    - `src/lib/meetings/{format,email}.ts`;
    - hooks `useMeetingData`, `useLiveTranscription`, `useScreenShareCapture`, `usePictureInPicture`;
    - `src/components/meeting/{MeetingHeader,TranscriptPanel,ParticipantsPanel,SummaryTab,ActionsDecisionsTab,TasksRecapTab,EmailTab}.tsx`.
  - `todo.tsx` is split into `hooks/useTodoTasks.ts` and `components/todo/{KanbanBoard,Column,TaskCard,TaskDetailDialog,CreateTaskDialog,TaskFilters}.tsx`.
  - `ai.functions.ts` is split into `src/server/ai/{gemini,summarize,action-items,recaps,project-summary,chat,transcription}.ts` and `src/server/tasks.ts`. The public `*.functions.ts` entry stays thin.
  - Shared: `lib/format.ts` (dates, `formatDuration`) and one `normalizeAssignee`.
  - Delete: root scratch scripts, `project-summary` function, `seedIfEmpty`, unused exports and imports.
  - Data fetching: adopt React Query (already installed) for list/detail queries where it removes hand-rolled loading and error state. This is not a rewrite.
- **Approach:** move code without behaviour change first (a separate commit per extraction), then fix lint (`no-explicit-any` 87, `no-empty` 17, `prefer-const` 12, exhaustive-deps 6).
- **Risks:**
  - Regressions in the complex recording flow. Mitigation: extract-only commits, manual smoke test of record → stop → summarise → tasks after each extraction.
  - Rollback: revert individual extraction commits.
- **Done when:**
  - No source file over 400 LOC (except generated `types.ts` and `routeTree.gen.ts`).
  - `npm run lint` has 0 errors.
  - Scratch files are gone.
  - Build passes.
  - The smoke checklist passes.

### Phase 5 — Design system, UI consistency, responsiveness and accessibility (4–6 days)
- **Objective:** implement §7.3 across all routes.
- **Files:** `src/styles.css`, `src/routes/__root.tsx` (`.dark`, `color-scheme`, font, Sonner theme), `src/components/ui/{button,badge,card,input,select}.tsx` (variants), new `src/components/layout/*`, `src/components/app-shell.tsx`, and then every route.
- **Sequence:**
  1. Tokens.
  2. Primitives.
  3. App shell (Sheet-based mobile nav, labelled icon buttons, role-aware nav, one brand name).
  4. Pages in rising order of difficulty: projects, profile, chat, reset-password, auth, dashboard, meetings.index, calendar (agenda view below `md`), todo (column switcher on mobile + keyboard/touch-friendly move), meetings.$id (replace the WhatsApp palette with brand surfaces), admin.
  5. Forms migrate to RHF + zod.
  6. Delete the UI components and dependencies still unused.
- **Risks:**
  - Visual regressions. Mitigation: before/after screenshots per route at 375 / 768 / 1280 / 1536 px (needs a browser tool; see D8).
  - Rollback: per-page commits.
- **Validation:**
  - Grep guard: 0 hex, `rgb(` or raw palette colour classes in `src/routes` and `src/components/{app-shell,layout}`.
  - 0 icon-only buttons without `aria-label`.
  - axe check per route (if approved) with 0 serious or critical issues.
  - Manual keyboard pass.
- **Done when:**
  - Every route renders loading, error and empty states.
  - No horizontal page scroll at 375 px.
  - All interactive elements are keyboard-reachable with a visible focus ring.
  - Contrast meets WCAG AA for text tokens.

### Phase 6 — Automated tests, performance and reliability (3–4 days)
- **Objective:** regression safety net and a lean bundle.
- **Tasks:**
  - Test runner decision (D8). Recommended: Vitest + Testing Library for components, keeping `node --test` for pure libraries if preferred.
  - pgTAP/SQL RLS tests in `supabase/tests/`.
  - Server-function tests with a mocked Supabase client and Gemini.
  - Optional Playwright smoke test of sign-in → create meeting → open detail.
  - Lazy-load heavy routes and libraries to bring the main chunk under ~300 kB (target to confirm); resolve the `inlineDynamicImports` warning.
  - Global Gemini deadline and concurrency guard.
  - Structured server logging (`console` JSON lines at minimum).
- **Done when:**
  - CI runs typecheck, lint, test and build on every PR and is green.
  - Coverage includes the middleware, every server function's error path, and RLS for every table.
  - Main client chunk is under the agreed budget.

### Phase 7 — Deployment hardening, documentation and release (1–2 days)
- **Tasks:**
  - `.github/workflows/ci.yml`.
  - Document environments: local, staging (Supabase branch or separate project, see D12) and production.
  - `supabase secrets` checklist; edge-function deploy steps; cron verification.
  - Rewrite `README.md` to match real features, setup, env vars and scripts.
  - `SECURITY.md` (key rotation, reporting).
  - Error tracking per D9.
  - Release checklist (§12) run against staging, then production.
- **Done when:** every item in §12 is checked with linked evidence (CI run, test output, screenshots, Supabase advisor output).

---

## 12. Production-readiness checklist

- [ ] Old Gemini key revoked; no secrets tracked; `.env.example` present; `git ls-files` contains no `.env`
- [ ] JWT verified on every server function (test)
- [ ] RLS: per-table tests pass; Supabase security advisors report 0 errors [U]
- [ ] Admin routes guarded client-side and server-side
- [ ] Edge functions authenticated, HTML-escaped, CORS restricted; reminders scheduled and idempotent
- [ ] Inputs validated with zod; payload size limits enforced
- [ ] 0 fabricated or scenario-specific data (grep guard in CI)
- [ ] No silent error swallowing in mutations (tests)
- [ ] `tsc` 0 errors · `lint` 0 errors · tests green · build green, all in CI
- [ ] `npm audit --omit=dev`: 0 critical/high
- [ ] Migrations reproduce the live schema; types generated from them
- [ ] Every §4 feature Implemented or explicitly de-scoped; no dead controls
- [ ] Design-system grep guards pass; loading/error/empty states on every route
- [ ] Responsive at 375/768/1280/1536 px; keyboard navigable; axe 0 serious
- [ ] Main bundle under budget
- [ ] README, env docs, deploy runbook, SECURITY.md current
- [ ] Staging sign-off before merge to the Lovable-synced `main`

---

## 13. Decisions needed from you

| # | Decision | Recommendation |
|---|---|---|
| **D1** | Key exposure: rotate only, or also purge Git history? | **Rotate now** (essential). Skip the history rewrite: AGENTS.md warns it breaks Lovable sync, and once a key is revoked, the copy left in history is harmless |
| D2 | Untrack `.env`? Does Lovable need it in Git? Is Google sign-in (README) in scope, via Supabase OAuth or Lovable cloud-auth? | Untrack and keep env in Lovable/Cloudflare settings. Supabase Google OAuth, since it is already used for Calendar linking |
| **D3** | Admin area: build real admin (service-role edge function) or remove the mock pages? | Remove now; rebuild later if needed |
| D4 | Package manager: bun or npm? | Match Lovable (bun); regenerate `bun.lock`, delete `package-lock.json`. Needs bun installed locally |
| D5 | Scope of missing features: notifications, semantic search, pre-meeting briefings, chat history | Notifications in; the others deferred |
| D6 | Public contact email and legal pages for the landing footer | — |
| D7 | Keep the app dark-only, or add a light theme? | Dark-only now, with tokens structured for light later |
| D8 | Approve dev tooling: Supabase CLI (local DB and RLS tests), Vitest + Testing Library, Playwright/axe | Approve the CLI and Vitest; Playwright optional |
| D9 | Error tracking and observability provider (e.g. Sentry, or Cloudflare logs only) | Choose before Phase 7 |
| D10 | `paper_revision/`: move out of this repo or gitignore it? | Move it out of the repo |
| **D11** | The uncommitted "continuous memory" / scenario logic: drop it, or keep only a generic, name-free version? Confirm you accept that the demo transcript and tasks will disappear | **Revised (see §14 G1):** keep Continuous Meeting Memory as a generic, tested feature; move the paper's scenario into a demo seed; remove all names, dates and IDs from product code |
| D12 | Staging: a Supabase branch or a separate project? | Supabase branch, if the plan allows |
| **D13** | Approve the Git plan in §10 (local-only WIP snapshot branch, `revamp/production-readiness` from `7f07084`) | — |

**2026-10-20 update:** you delegated decisions. Claude will apply the recommendations above as defaults.

Explicit confirmation will still be requested before anything irreversible or outward-facing:
- applying migrations to a live database;
- pushing to or merging into the Lovable-synced `main`;
- deleting deployed edge functions;
- dropping the demo data (D11).

You personally must still do the following, because they need your own accounts:
- revoke the leaked Gemini key (D1);
- revoke the Supabase access token pasted in chat (§15).

---

## 14. Known gaps in this plan (self-review, 2026-10-20)

### 14.1 Changes this review makes to the plan

**G1 — The research paper depends on the "continuous memory" feature** [V]
- `paper_revision/build_revised_research_paper.py` describes this app (:39, :100) and its *Continuous Meeting Memory (CMM) engine* (:159).
- It cites the Meeting 1 / Meeting 2 / "Shreyash" scenario as evaluation evidence (:674).
- So the D11 recommendation ("drop the scenario logic") was too blunt.

The revised approach is to keep CMM as a **generic product feature**:
- cross-meeting task continuity, reconciliation and completion detection;
- no hard-coded names, dates or IDs;
- with tests.

The paper's scenario then lives as a **reproducible demo seed** (`supabase/seed/demo_cmm.sql` plus a dedicated demo account) instead of being injected into live user data.

**New decision D14:** freeze the paper's evaluation build before refactoring. Tag `paper-eval-2026-10` on the WIP snapshot so the published results stay reproducible.

**G2 — Fabricated rows already in the live database**
- Phase 2 removes the *code* that fabricates data, but not the rows it has already written: scripted transcripts, renamed "Shreyash" participants, invented summaries, decisions and tasks.
- Add **Phase 2.5 — data cleanup**:
  1. read-only identification queries on the live project;
  2. an export/backup of the affected rows;
  3. a reviewed cleanup script.

  This needs live-DB access (§15) and your confirmation.

### 14.2 Areas not yet covered

**G3 — Privacy and legal (UK GDPR)**
- The app records and transcribes **other people's** speech, and sends audio, transcripts and screenshots to Google Gemini.
- Missing today:
  - a recording-consent notice and in-meeting indicator;
  - a privacy policy (the footer link is `href="#"`, `index.tsx:270`) and terms;
  - Gemini's role as a data processor (data-processing terms, paid vs free tier data use);
  - a retention policy and deletion/export of a user's data;
  - no LICENSE file in a public repository.
- New decisions:
  - **D15:** licence;
  - **D16:** retention period and whether raw audio is ever stored (no storage usage exists today).

**G4 — Abuse and cost controls**
- No per-user rate limiting or daily AI quota anywhere (grep: none).
- Size limits (Phase 1) are not enough: one user can still loop calls.
- Add to Phase 1:
  - a per-user quota table plus check in the middleware;
  - AI usage logging (tokens, model, cost estimate);
  - an admin view of usage (replacing the mock `admin.ai.tsx`).

**G5 — Runtime limits on Cloudflare Workers** [U]
- Long Gemini calls (transcription, retries) and large base64 bodies may exceed Workers' CPU, memory or request-size limits.
- The limits depend on the Lovable plan. These are not verified.
- Add a Phase 1 spike: measure on staging, and move long jobs to an edge function or background queue if needed.

**G6 — Recording reliability and browser support**
- Live transcription uses the Web Speech API (`meetings.$id.tsx:670, 1366`): Chromium only, and it needs network access.
- Not covered:
  - Safari/Firefox fallback (e.g. chunked `MediaRecorder` → Gemini for everyone);
  - long meetings (more than 60 minutes: memory, chunking);
  - recovery after tab crash or refresh mid-meeting;
  - mobile recording;
  - a clear "unsupported browser" state.
- Add to Phase 3, with a manual test matrix.

**G7 — Realtime channel security**
- `postgres_changes` subscriptions (`todo.tsx:768`, `meetings.$id.tsx:1338`) inherit table RLS, so the action_items RLS fix (S3) also fixes realtime leakage.
- This must be verified explicitly in the RLS tests.

**G8 — Security headers**
- No CSP, HSTS, `X-Frame-Options`/`frame-ancestors` or `Referrer-Policy` are set (grep: none).
- Add to Phase 7 via the nitro/Cloudflare response headers. Check compatibility with the Lovable preview iframe [U].

**G9 — Backups and recovery**
- Point-in-time recovery or backup schedule, plus a restore drill [U, depends on who owns the project].
- Add to Phase 7.

**G10 — AI output quality**
- There is no evaluation set for summary, action-item or decision accuracy, so prompt changes cannot be checked for regressions.
- Add a small golden-transcript eval (the paper's scenarios are a natural source) run on demand, not in CI, because it costs API calls.
- Also: confirm the hard-coded model IDs exist [U].

**G11 — Working alongside Lovable**
- Large refactors on a branch will conflict with any edits made in the Lovable editor on `main` meanwhile.
- **New decision D17:** freeze Lovable edits during the revamp, or merge `main` into the revamp branch at the end of every phase.

**G12 — Product scope and effort**
- Acceptance criteria are technical; there is no agreed MVP or feature priority.
- Rough total: ~25–35 working days if done in full.
- **New decision D18:** what is the target? Options:
  - (a) paper demo and portfolio;
  - (b) a pilot with real users;
  - (c) a public launch.

  The answer decides how much of Phases 3, 5 and 6 is required.

**G13 — Audit limits (what was *not* verified)**
- The app was not run in a browser, so the UI and responsive findings are static-analysis only.
- No screenshots exist yet.
- The live Supabase state (policies, auth settings, deployed functions, data) was not inspected (§15).
- Phase 0 should add one runtime smoke pass: run the app locally, walk every route, capture console errors.

**G14 — Developer experience**
- No dependency-update automation (Dependabot/Renovate).
- No pre-commit hooks.
- No local seed data for development.
- Add to Phase 7 and Phase 0 respectively.

---

## 15. Supabase access (verified 2026-10-20)

- The Supabase connector in this session reaches an organization with two projects, "Production" (`xpxg…`) and "Staging" (`dbgk…`).
  - Staging's tables (cases, payments, mentoring and others) belong to a **different application**.
  - **Neither project is this app.** This app's `.env` points at `aasrwv…`, and `config.toml` names `spomto…`. The app's project is probably managed by Lovable Cloud [S].
- **Recommended access path** (no prod credentials needed for most work):
  1. Local Supabase via Docker (installed) plus the Supabase CLI (D8), so migrations and RLS tests run locally.
  2. For the live project, apply reviewed migrations through Lovable, or through a Supabase connector/CLI login that you perform yourself against the org that owns `aasrwv…`. Never paste tokens into chat or into files.

---

## 16. Implementation status (2026-10-20)

Branch `revamp/production-readiness` (local, not pushed). Your earlier work is preserved on `wip/continuous-memory-snapshot`, tagged `paper-eval-2026-10`.

### Verified locally
| Check | Before | After |
|---|---|---|
| `npm run typecheck` | 65 errors | **0** |
| `npm run lint` | 2,402 problems | **0** (`--max-warnings 0`) |
| `npm test` | 12 pass | **18 pass** |
| `npm run build` | pass, 557 kB main chunk | **pass**, 453 kB main chunk |
| `npm audit --omit=dev` | 12 vulns (6 critical) | **0** |
| SQL / RLS tests (pglite) | none | **22/22 pass** (not committed) |
| Fabricated data grep | ~109 hits | **0** in product code |
| Raw colour / hex grep | hundreds | **0** outside `components/ui` |
| `aria-label`s | 0 | 50 |
| Dev server route smoke test | — | every route responds; unknown route 404 |

### Done, by phase
- **Phase 0:** untracked `.env` and `supabase/.temp`, added `.env.example`, removed scratch scripts and boilerplate function, formatting commit.
- **Phase 1 / 1B:**
  - JWT verification in server functions;
  - `is_admin()`, admin guard and read-only admin policies;
  - fixed action-item RLS (`assignee_user_id`);
  - protected profile fields;
  - disabled accounts are read-only;
  - zod validation, ownership checks and AI daily limits on every server function;
  - hardened edge functions;
  - auth rebuilt: Google sign-in restored, email confirmation, password rules, recovery-only reset, redirect back, sign-out clears data;
  - dependency CVEs fixed.
- **Phase 2:**
  - all fabricated transcripts, participants, tasks, summaries and names removed;
  - DB-generated task IDs with canonical keys;
  - upserts instead of delete-then-insert;
  - errors surface to the UI;
  - schema-synced types;
  - Continuous Meeting Memory kept, now generic;
  - paper scenario moved into `seed_demo_workspace()`.
- **Phase 3:**
  - real dashboard and admin data;
  - notifications bell;
  - search page;
  - pre-meeting briefing;
  - saved chat history;
  - Google Calendar import with reconnect;
  - confirmation and reminder emails;
  - working profile and connected accounts;
  - landing links fixed.
- **Phase 4:**
  - meeting page split from 3,777 lines into hooks and components;
  - to-do board split;
  - AI server code split into `src/server/*`;
  - mock data removed.
- **Phase 5:**
  - design tokens and layout primitives;
  - every page migrated;
  - mobile layouts for calendar, tasks and navigation;
  - keyboard and screen-reader fixes.

### Still requires you (cannot be done from this machine)
1. Revoke the leaked Gemini key and the pasted Supabase token.
2. Apply `supabase/migrations/20261020120000_revamp_core.sql` then `20261020130000_meeting_status.sql` to the live project (`aasrwv…`), via Lovable or the SQL editor (see `docs/BACKEND.md`). The app's new features need them.
3. Make yourself admin with the SQL snippet in `docs/BACKEND.md`.
4. Supabase Auth settings:
   - redirect URLs `/auth` and `/reset-password`;
   - minimum password length 8;
   - leaked-password protection;
   - manual identity linking (for Connect Google);
   - Google provider with the `calendar.readonly` scope.
5. Edge secrets: `RESEND_API_KEY`, `EMAIL_FROM`, `ALLOWED_ORIGINS`, `REMINDERS_CRON_SECRET`. Deploy both edge functions, and run `supabase/sql/schedule_reminders.sql` for automatic reminders.
6. Check that the Gemini model names work with your key, or set `GEMINI_MODEL`.

### Not yet done
- Browser click-through with a signed-in account. This needs the migrations applied to the live database first; use the QA checklists from the agent reports, summarised in the final hand-off.
- Automated component and E2E tests, CI workflow, security headers and error tracking (Phases 6–7). These are optional for a college submission.
