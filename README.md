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
cp .env.example .env.local     # then fill in DATABASE_URL (see below)
npm run db:migrate             # apply schema migrations (drizzle/*.sql)
npm run db:seed -- --yes-wipe  # WIPES that database and loads the demo company
npm run dev                    # http://localhost:3000
```

**Which database?** `vercel link && vercel env pull .env.local` hands you the **production**
`DATABASE_URL` — seeding it wipes the live demo. There is a separate dev database (`calltime-dev-db`),
pulled into the same file as `DEVDB_DATABASE_URL` / `DEVDB_DATABASE_URL_UNPOOLED`; use those for local
work (they're what the lab dev deploy below runs on), or create your own Neon branch. The seed refuses
to run without `--yes-wipe` and prints the host it is about to truncate.

Push notifications need a VAPID key pair: `npx web-push generate-vapid-keys`, then set
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (a `mailto:` you own). Without them push
is simply off.

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
already applied. `npm run db:push` (interactive `drizzle-kit push`) remains only for throwaway local
databases: it diffs the live schema and may drop columns or data to match, so never point it at a
database anyone else uses.

`npm run typecheck`, `npx eslint src`. Demo accounts and the domain/permission model are in
[`docs/SPEC.md`](docs/SPEC.md); the design system in [`docs/DESIGN.md`](docs/DESIGN.md); UX guidelines and
review in [`docs/ux/`](docs/ux); competitive research and feature ideas in [`docs/research/`](docs/research).

### Dev deploy on the lab k3s cluster

Dev runs in the lab cluster (namespace `dev-calltime`) at https://calltime.lab.kleincogroup.com,
against its **own** Neon database (`calltime-dev-db`, exposed to the Vercel project's
development env as `DEVDB_*`), not the production one.

```bash
export KUBECONFIG=~/.kube/config   # the k3s kubectl otherwise reads /etc/rancher/k3s/k3s.yaml (root-only)
SHA=$(git rev-parse --short HEAD)
docker build -t registry.lab.kleincogroup.com/calltime/calltime:$SHA . && docker push registry.lab.kleincogroup.com/calltime/calltime:$SHA
sed -i -E "s/newTag: .*/newTag: $SHA/" k8s/kustomization.yaml
(set -a; . ./.env.k3s; set +a; npx tsx scripts/migrate.ts)   # migrate the dev DB first
kubectl -n dev-calltime apply -k k8s/
```

The image runs the bare `npm run build:app`, so it never touches a database at build time.

`.env.k3s` (gitignored) is the dev environment file: `DATABASE_URL` and `DATABASE_URL_UNPOOLED` from the
`DEVDB_*` values in `.env.local`, dev-only VAPID keys (`npx web-push generate-vapid-keys`; never reuse
production's), `VAPID_SUBJECT`, `APP_URL=https://calltime.lab.kleincogroup.com`, `DEMO_MODE=1`, and
`SEED_ADMIN_PASSWORD` for seeding. `scripts/migrate.ts` and `scripts/seed.ts` print the database host
they target; migrate only reads `.env.local` when no `DATABASE_URL` is exported.

The pod's runtime config is the Secret `calltime-env`, built from the runtime keys only (never committed;
`--from-env-file` keeps quotes literally, hence the `sed`):

```bash
grep -E '^(DATABASE_URL|VAPID_PUBLIC_KEY|VAPID_PRIVATE_KEY|VAPID_SUBJECT|NEXT_PUBLIC_VAPID_PUBLIC_KEY|APP_URL|DEMO_MODE)=' .env.k3s \
  | sed -E 's/^([A-Z_]+)="(.*)"$/\1=\2/' \
  | kubectl -n dev-calltime create secret generic calltime-env --from-env-file=/dev/stdin --dry-run=client -o yaml \
  | kubectl apply -f -
```

Reseed the dev database: `set -a; . ./.env.k3s; set +a; npx tsx scripts/seed.ts --yes-wipe`.

### Connect Claude (MCP)

Create a key at `/org/api-keys`, then:

```bash
claude mcp add --transport http calltime https://<host>/api/mcp --header "Authorization: Bearer ct_…"
```

### Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres, pooled (provisioned by the Vercel Neon integration) |
| `DATABASE_URL_UNPOOLED` | Direct (non-pooled) connection; migrations and drizzle-kit use it when set |
| `SEED_ADMIN_PASSWORD` | Password the seed gives the platform admin `admin@calltime.dev` (a random one is printed if unset) |
| `APP_URL` | Public base URL (e.g. `https://calltime.app`) used in invite, reset and calendar links; set it in production so a spoofed `Host` header can't mint links to another domain |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web push (`npx web-push generate-vapid-keys`); push is skipped if unset |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Optional alias of `VAPID_PUBLIC_KEY` exposed to the browser; either works |
| `DEMO_MODE=1` | Shows one-tap demo sign-in for the seeded demo accounts in production |
| `RESEND_API_KEY`, `RESEND_FROM` | Optional: email the weekly change digest (preview at `/api/digest/preview`) |

## Deploy

Vercel project `calltime` (team Kleintech). The project is not connected to GitHub yet, so pushes
don't create previews; deploys are made from the CLI:

```bash
vercel link                        # once per clone
vercel deploy --prod               # builds with `npm run build`, which runs db:migrate first
```

Production has `DEMO_MODE=1` (one-tap demo sign-in on the landing page) and `APP_URL` set to the
public URL. Connecting the GitHub repo in the Vercel project settings turns every branch push into a
preview deployment; migrations then run against whatever `DATABASE_URL` that environment has, so give
previews their own Neon branch before enabling it.
