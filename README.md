# Calltime

Rehearsal schedules and call times for theater companies. The creative team schedules rehearsals
**by scene**; every actor and their parents/guardians instantly see **exactly when they're called** —
in the app, as phone notifications when something changes for *their* kid, and in a subscribed
calendar feed. Replaces chat-feed scheduling (Band, GroupMe) where families had to read every post.

Prototype: https://calltime-psi.vercel.app (demo sign-in buttons on the landing page; every demo password is `calltime`).

## What's in it

- **Tenancy** — platform admin creates companies (`/admin`); company admins manage people, members,
  invites and API keys (`/org`).
- **Productions** — roles (lead/supporting/featured/ensemble, doubling, understudies), role groups,
  scenes, the scene × role breakdown, cast with guardians, creative team, spreadsheet import.
- **Schedule** — events (rehearsal, tech, dress, performance, fitting…) made of timed blocks that call
  scenes, groups, roles, people or the full cast. Live "who's called" preview with conflict warnings,
  drafts → publish, copy week, call sheet, attendance with minor sign-out, rehearsal reports, actor notes.
- **Families** — My Calls (`/home`): next call, per-kid alerts for changes with "Got it", cancellations,
  notes, materials, volunteer shifts, "Can't make it" conflicts.
- **Change tracking** — every edit to a published event is diffed per person; only families whose own
  calls changed are alerted (in-app + web push). Directors see who has and hasn't seen a change.
- **Calendar** — per-user secret iCalendar feed (`/api/calendar/<token>.ics`) for Apple/Google/Outlook.
- **Auditions** — public signup with slots and date conflicts (`/audition/<slug>`), check-in, callbacks,
  casting into people/guardians/roles (conflicts carry over into scheduling).
- **MCP server** (`/api/mcp`) — 27 tools so an AI assistant can build a production from a script and cast
  list (`import_production`), schedule rehearsals and read call sheets. Keys at `/org/api-keys`.

## Stack

Next.js 16 (App Router, Server Actions) · TypeScript · Tailwind v4 · Drizzle ORM · Neon Postgres ·
web-push · mcp-handler. Deployed on Vercel (project `calltime`, team Kleintech).

## Run it

```bash
npm install
vercel env pull .env.local     # or set DATABASE_URL (+ VAPID_* for push) yourself
npm run db:migrate             # apply schema migrations (drizzle/*.sql)
npm run db:seed                # WIPES the database and loads the demo company
npm run dev                    # http://localhost:3000
```

### Schema changes

The schema lives in `src/db/schema.ts`; the database is changed only through SQL migrations in
`drizzle/`, never by hand:

```bash
# 1. edit src/db/schema.ts
npm run db:generate -- --name add_widgets   # writes drizzle/000N_add_widgets.sql + meta
npm run db:migrate                          # applies pending migrations to DATABASE_URL
```

Commit the generated files. `npm run build` runs `db:migrate` first, so every Vercel deploy applies
pending migrations before the new code goes live. A database that was created with the old
`drizzle-kit push` flow is recognised on the first run and the baseline migration is recorded as
already applied. `npm run db:push` remains only for throwaway local databases.

`npm run typecheck`, `npx eslint src`. Demo accounts and the domain/permission model are in
[`docs/SPEC.md`](docs/SPEC.md); the design system in [`docs/DESIGN.md`](docs/DESIGN.md); UX guidelines and
review in [`docs/ux/`](docs/ux); competitive research and feature ideas in [`docs/research/`](docs/research).

### Connect Claude (MCP)

Create a key at `/org/api-keys`, then:

```bash
claude mcp add --transport http calltime https://<host>/api/mcp --header "Authorization: Bearer ct_…"
```

### Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres (provisioned by the Vercel Neon integration) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web push; push is skipped if unset |
| `DEMO_MODE=1` | Shows one-tap demo sign-in for the seeded demo accounts in production |
| `RESEND_API_KEY`, `RESEND_FROM` | Optional: email the weekly change digest (preview at `/api/digest/preview`) |
