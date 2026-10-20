# AI Meeting Companion

A web app that records meetings in the browser, transcribes them live, and uses Google Gemini to produce summaries, action items, decisions and pre-meeting briefings. It also keeps a "continuous meeting memory" that links tasks and decisions across meetings in the same project.

Built with TanStack Start (React 19), Tailwind CSS v4 + shadcn/ui, Supabase (Postgres, Auth, Realtime, Edge Functions) and Google Gemini. Hosted through Lovable on Cloudflare Workers.

## Features

| Area           | What it does                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Accounts       | Email/password sign-up with email confirmation, Google sign-in, password reset, profile and connected accounts               |
| Meetings       | Create, schedule, search, filter and delete meetings; optional project; confirmation email when scheduling                   |
| Live recording | Microphone transcription (Chrome/Edge) plus optional capture of a shared call tab's audio, floating mini-window              |
| AI             | Meeting summary, action items, decisions, per-participant recaps, transcript clean-up, pre-meeting briefing, project summary |
| Tasks          | Kanban board (pending / in progress / done) with drag-and-drop, keyboard "Move to…" menu and a phone layout                  |
| Calendar       | Month grid (agenda list on phones), Google Calendar import                                                                   |
| Chat           | Ask questions about your meetings; history is saved                                                                          |
| Search         | Search across meeting titles, transcripts, summaries, tasks and decisions                                                    |
| Notifications  | In-app bell for summaries and reminders, updated live                                                                        |
| Admin          | Overview stats, user management (admin role, disable/enable), all meetings, AI usage                                         |

## Getting started

Requirements: Node.js 20+ (or Bun), a Supabase project, a Gemini API key.

```bash
npm install
cp .env.example .env   # fill in the values
npm run dev
```

Then apply the database migrations and settings described in [docs/BACKEND.md](docs/BACKEND.md).

### Scripts

| Command             | Purpose                                |
| ------------------- | -------------------------------------- |
| `npm run dev`       | Start the dev server                   |
| `npm run build`     | Production build                       |
| `npm run typecheck` | TypeScript check                       |
| `npm run lint`      | ESLint + Prettier check                |
| `npm test`          | Unit tests (continuous meeting memory) |

## Configuration

All variable names are listed in `.env.example`; their meaning and the edge-function secrets are in [docs/BACKEND.md](docs/BACKEND.md). Never commit `.env`.

## Project structure

```
src/
  routes/                 pages (file-based routing); _authenticated/* need sign-in, admin.* need the admin role
  components/layout/      PageHeader, EmptyState, ErrorState, LoadingState, ConfirmDialog, StatusBadge, ...
  components/meeting/     meeting page pieces (transcript, summary, tasks, email, briefing)
  components/todo/        task board pieces
  components/ui/          shadcn/ui components
  hooks/                  meeting recording, transcription, screen capture, tasks
  lib/auth/               session, profile and admin hooks
  lib/*.functions.ts      server functions (AI, briefing) — run on the server only
  lib/continuous-memory.ts  cross-meeting task and decision logic (+ tests)
  server/                 server-only helpers (Gemini client, usage limits, validation)
supabase/
  migrations/             database schema, security policies and RPCs
  functions/              send-confirmation and send-reminders edge functions
  sql/                    optional manual setup (reminder schedule)
docs/                     backend guide and the original product brief
```

## Security notes

- Every server function verifies the caller's Supabase access token and checks meeting ownership.
- Row-level security protects all tables; admins have read-only access to other users' data and change it only through audited admin functions.
- AI usage is logged and limited per user per day.

## Documentation

- [docs/BACKEND.md](docs/BACKEND.md): migrations, secrets, first admin, reminders, AI limits
- [docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md): turning on Google sign-in and calendar import (off by default)
- [REVAMP_PLAN.md](REVAMP_PLAN.md): audit and revamp plan
- [docs/ORIGINAL_SPEC.md](docs/ORIGINAL_SPEC.md): the original product brief
