# Calltime — product & engineering spec

Calltime replaces chat-based rehearsal scheduling (e.g. Band) for theater companies. The creative
team schedules rehearsals **by scene**; every actor and their guardians automatically see
**exactly when they're called**, in the app and in a subscribed calendar feed.

## Users

| Who | How identified | Can |
|---|---|---|
| Platform admin | `users.isPlatformAdmin` | Create tenants (orgs), make users org admins. `/admin` |
| Org (tenant) admin | `orgMembers.role = admin` | Create productions, assign creative team, manage people, invites, API keys. `/org` |
| Creative team | `creativeTeam` row (title: Director, Choreographer, Music Director, Stage Manager, …) | Edit one production: roles, scenes, cast, schedule, auditions |
| Performer | `people.userId = user.id` | See own calls, report conflicts, subscribe to calendar |
| Guardian | `guardianships.guardianId` → people row with `userId` | Same as performer, for each of their minors |

Minors usually have no account; their guardians do. Older kids may have their own account.

## Domain model (src/db/schema.ts — the source of truth)

- `organizations` (tenant, has `timezone`) → `productions` → `roles`, `scenes`, `roleGroups`, `events`, `auditions`, `announcements`
- `people` are org-scoped, persist across productions. `roleAssignments(role, person, kind: primary|understudy|swing)`; a person can hold several roles, a role can have many people (ensembles).
- `roleGroups` bundle roles ("Pirate Band", "Constabulary") so a block can call a group.
- `sceneRoles` = the scene breakdown (which roles appear in each scene).
- `events` = rehearsals, performances, tech, dress, fittings, meetings. `status`: draft (creative team only) → published → cancelled. `revision` bumps on each material change after publishing.
- `eventBlocks` = timed segments of an event. `blockCalls(target: scene|role|group|person|all_cast, targetId)` = who each block calls.
- **Call time** for a person at an event = earliest start of any block calling them; release = latest end. Implemented in `src/lib/calls.ts` (`getCallsForPeople`, `getEventCallSheet`, `loadCastIndex`, `buildCallSheets`). Scene/group calls skip understudies; role calls include them. Do not reimplement this logic — call it.
- `conflicts` = performer unavailability; shown to the creative team when scheduling.
- `auditions` → `auditionSlots(kind: audition|callback, capacity)` → `auditionSignups(status: registered → checked_in → auditioned → callback → cast | not_cast | withdrawn)`. Public signup at `/audition/<slug>`; a signup can be converted to a `people` row + role assignment on casting.
- `invites` = shareable links `/invite/<token>` that create/attach an account and grant org role / creative team seat / link to a person / guardian-of a person.
- `apiKeys` = hashed bearer tokens for the MCP endpoint, scoped to one org and acting as one user.

## Conventions

- Next.js 16 App Router (read `node_modules/next/dist/docs/` before using unfamiliar APIs: `params`/`searchParams` are Promises, `cookies()` is async, use `PageProps<"/route">` / `LayoutProps` global types, `proxy.ts` replaced middleware). No cacheComponents.
- Data access: Drizzle (`import { db } from "@/db"`, tables from `@/db/schema`). Server Components read; **Server Actions** mutate (colocated `actions.ts` with `"use server"`), then `revalidatePath`. Validate input with zod.
- Authorization in every action and page: `requireUser`, `requireProductionAccess(id)`, `requireProductionEditor(id)`, `requireOrgAdmin(orgId)`, `requirePlatformAdmin` (`src/lib/access.ts`, `src/lib/auth.ts`). Never trust ids from forms: check the row belongs to the production you authorized.
- Times: stored UTC; always render in the org's timezone with helpers in `src/lib/time.ts` (`fmtTime`, `fmtRange`, `fmtDay`, `toLocalInput`, `fromLocalInput`…). Never `toLocaleString()` without a timezone.
- UI: mobile-first (design at 375px wide first; must also look right on desktop). Use primitives in `src/components/ui.tsx` and the semantic color tokens in `globals.css` (`bg-surface`, `text-muted`, `border-line`, `bg-accent`, `text-gold`…). Icons from `lucide-react`. Forms: one column, 44px+ touch targets, labels above inputs. Client components only where interaction needs them.
- Signed-in pages live under `src/app/(app)/` (shell with bottom tabs / side rail). Production pages under `src/app/(app)/p/[productionId]/` get the production header + tabs from its layout.

## Dev

- `.env.local` holds `DATABASE_URL` (Neon). `npm run db:push` applies schema changes; `npm run db:seed` wipes and loads the demo ("Riverside Youth Theatre": *Pirates of Penzance* in rehearsals, *Midsummer* in auditions). All demo passwords: `calltime`.
- Shared dev server: http://localhost:3100 (already running; hot reloads). Authed requests: `curl -b "$(npm run -s dev-login -- director@riverside.dev)" http://localhost:3100/...`
- Demo users: `admin@calltime.dev` (platform admin), `office@riverside.dev` (org admin), `director@` `choreo@` `music@` `sm@riverside.dev` (creative team), `dana@family.dev` (guardian of Maya & Leo), `marcus@family.dev` (guardian of Ava), `sam@family.dev` (teen performer, Frederic).
- Checks: `npm run typecheck`, `npx eslint <paths>`. Scripts importing `src/lib/*` need `npx tsx --conditions=react-server --env-file=.env.local`.
