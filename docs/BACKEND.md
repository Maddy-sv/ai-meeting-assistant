# Backend guide

This app uses Supabase (Postgres, Auth, Realtime, Edge Functions) and TanStack Start server functions that call Google Gemini.

## 1. Database migrations

Apply the files in `supabase/migrations/` in filename order:

1. `20260702152826_7557f98d-….sql`: roles, profiles, meetings, participants, transcripts, summaries, action items, decisions, notifications
2. `20260702152850_e96e9b81-….sql`: function permissions
3. `20260820184527_todo_rls.sql`: old assignee policies (removed again by step 5)
4. `20260906191830_add_projects.sql`: projects and `meetings.project_id`
5. `20261020120000_revamp_core.sql`: the security and feature migration:
   - `is_admin()`;
   - admin read-only policies;
   - profile protection;
   - `action_items.assignee_user_id`, `canonical_key` and `updated_at`;
   - `chat_messages` and `ai_usage`;
   - the admin RPCs and `search_workspace`;
   - realtime publication.
6. `20261020130000_meeting_status.sql`:
   - `meetings.status` is limited to `upcoming`, `live` or `completed` (old `in_progress` rows become `live`, unknown values become `upcoming`);
   - `is_active_user()`: disabled accounts can still read their own data but cannot insert, update or delete it;
   - `my_open_task_count()` for the dashboard.
7. `20261020150000_remove_demo_seed.sql`: removes the demo-data function and the admin AI-usage report.

How to apply them:

- **Supabase CLI:** run `supabase db push` against the linked project.
- **Dashboard or Lovable:** paste each file into the SQL editor in the order above.

The last two migrations are safe to run more than once.

### What the revamp migrations change for existing data

- Action-item statuses are normalised: `completed` becomes `done`, and unknown values become `pending`.
- `assignee_user_id` is backfilled when the free-text assignee **exactly** matches one user's full name or email (case-insensitive) and the match is unique.
- New tasks get `assignee_user_id` automatically when the assignee is:
  - the host's own name or email;
  - an account email;
  - or a participant of that meeting whose email belongs to an account.
- Assignees can see their tasks and change **only** the status.
- Admins can read all meetings and records. They change other users' data only through the `admin_*` RPCs.
- Meeting statuses are normalised as described in step 6, and disabled users become read-only.

## 2. Environment variables and secrets (names only)

| Name                                                             | Where                       | Purpose                                                                                       |
| ---------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`             | app (client build)          | Browser Supabase client                                                                       |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`                       | app server                  | Server functions (RLS-scoped client, JWT verification)                                        |
| `GEMINI_API_KEY`                                                 | app server                  | Gemini API                                                                                    |
| `GEMINI_MODEL`                                                   | app server, optional        | Model to use (default `gemini-3.5-flash`)                                                     |
| `GEMINI_FALLBACK_MODEL`                                          | app server, optional        | One fallback model (default `gemini-3.5-flash-lite`; `none` disables)                         |
| `AI_DAILY_LIMIT`                                                 | app server, optional        | AI requests per user per UTC day (default 200)                                                |
| `AI_TRANSCRIBE_DAILY_LIMIT`                                      | app server, optional        | Live tab-audio transcription clips per user per UTC day (default 2000)                        |
| `RESEND_API_KEY`                                                 | edge secret                 | Sending email                                                                                 |
| `EMAIL_FROM`                                                     | edge secret, optional       | Sender, e.g. `Meeting Companion <noreply@your-domain>`; defaults to the Resend sandbox sender |
| `ALLOWED_ORIGINS`                                                | edge secret, optional       | Comma-separated origins allowed to call `send-confirmation` (defaults to localhost dev ports) |
| `REMINDERS_CRON_SECRET`                                          | edge secret                 | Shared secret required by `send-reminders`                                                    |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | edge (injected by Supabase) | Used by the edge functions                                                                    |

To set edge secrets, run `supabase secrets set NAME=value`, or use Dashboard → Edge Functions → Secrets.

> **Note:** check that the default Gemini model names exist for your API key. Override them with `GEMINI_MODEL` if they don't.

## 3. Making the first admin

Sign up in the app first. Then run this in the SQL editor, using your own email:

```sql
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'you@example.com'
on conflict (user_id, role) do nothing;
```

Once you are an admin, you can promote or demote others from the admin pages, which use `admin_set_user_role`.

There are two safeguards: an admin cannot remove their own admin role, and cannot disable their own account.

## 4. Edge functions and reminders

Deploy the functions:

```
supabase functions deploy send-confirmation
supabase functions deploy send-reminders --no-verify-jwt
```

What each function does:

- **`send-confirmation`:** requires the user's access token. It emails only the signed-in user.
- **`send-reminders`:** requires the header `x-cron-secret: <REMINDERS_CRON_SECRET>`. It emails hosts about meetings in the next 24 hours, at most once per meeting, and adds an in-app notification.

To schedule reminders, follow the steps at the top of `supabase/sql/schedule_reminders.sql`:

1. Enable `pg_cron` and `pg_net`.
2. Set the secret.
3. Store the project URL and the secret in Vault.
4. Run the file once in the SQL editor.

`schedule_reminders.sql` is not a migration.

## 6. AI limits and behaviour

- Each Gemini call:
  - uses `GEMINI_MODEL`, plus at most one fallback model;
  - retries a transient error once;
  - has an overall deadline of about 25 seconds.
- Every call is logged in `ai_usage` with the function, model, success flag and duration.
- When a user reaches `AI_DAILY_LIMIT` calls in a UTC day, further calls fail with "Daily AI limit reached. Try again tomorrow."
- Live tab-audio transcription (`transcribeRemoteAudio`, one call per ~12 second clip, so roughly 300 calls per hour of meeting) is still logged in `ai_usage` but does **not** count towards `AI_DAILY_LIMIT`. It has its own cap, `AI_TRANSCRIBE_DAILY_LIMIT` (default 2000 clips per user per UTC day), so a long meeting can never use up the allowance the end-of-meeting summary needs.
- Input limits:
  - audio clips up to 15 MB;
  - screenshots up to 4 MB each, at most 3;
  - chat messages up to 4,000 characters;
  - transcript text up to 200,000 characters (long transcripts are trimmed in the middle before being sent to the model).
- Meeting text is passed to the model as delimited data, and the model is told not to follow instructions inside it.
- Server functions verify the Supabase JWT (signature and expiry) and refuse disabled accounts.
- Server functions also check that the caller owns the meeting or project before changing anything.

