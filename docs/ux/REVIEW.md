# Calltime UX review — round 1 (2026-10-05)

Method: heuristic walkthrough per persona against the live dev server (http://localhost:3100) at
375×812 with headless Chromium (full-page screenshots + extracted text + automated checks for input
font size < 16px, tap targets < 40px and horizontal overflow). Screenshots:
`/tmp/claude-1000/-home-jklein-dev-calltime/d0ced4ac-a0aa-44f4-a180-ca7b2e904e8a/scratchpad/ux-shots/`.
Measured against `docs/ux/GUIDELINES.md`. Reviewed at ~11:40 PM ET, so today's (Mon Oct 5) rehearsal
was already over — its absence from Calls home is correct, not a bug.

Personas covered: Dana (guardian, 2 kids), Sam (teen), Jordan (director), Pat (org admin),
anonymous (invite link, audition signup, login). Not exercised: actually submitting the audition
or invite forms (they'd write to the shared DB).

Data note: the live DB contains other agents' test data (Dana is "Admin" of "Test Lakeside Players"
so she sees a **Company** tab and a "New production" button; "TEST Thursday pickup", "QA Test Show").
Those are data drift, not findings.

**What's already good** (keep it): Calls home groups multiple kids per event with per-kid chips and
times; cancelled events stay listed with a badge + strikethrough; calendar page explains Apple / Google
/ Outlook in plain words and warns about the private link; conflicts are shown per block and as a
summary in the editor; org overview flags "24 minors have no guardian on file — nobody will see their
calls. Fix →"; audition form reveals guardian fields only for under-18; event confirmations name the
consequence for families; "Copy to next week" and "Publish 8 drafts" exist on the schedule.

---

## P0 — a parent could miss or misread a call

### P0-1 Cancellations and changes are below the fold on Calls home
- **Route:** `/home` (Dana)
- **Problem:** Wed Oct 7's *Extra Rehearsal — Daughters* (Maya, 4:00–5:30 PM, two days out) is
  cancelled, and Thu Oct 8 is cancelled, but both appear only in "Coming up", ~880px down, under the
  hero, the calendar card and the conflicts card. The hero skips cancelled events (`next` = first
  non-cancelled), so the screen leads with "Next call Wed 6:00 PM" and says nothing about the 4:00
  slot that just disappeared. A parent who opens, sees the hero and closes will never see the
  cancellation — the exact chat-feed failure this app exists to fix. The hero's "Updated" badge is
  likewise the only sign of a change, with no "what changed".
- **Fix:** Add an alert strip **above the hero** when any call in the next ~14 days is cancelled or
  updated and not yet seen (until per-user seen-tracking exists: changed/cancelled in the last 72h):
  `⚠ 2 changes — Wed 4:00 Daughters rehearsal CANCELLED (Maya) · Thu Oct 8 CANCELLED (Maya, Leo)`
  → each row links to the card. When a cancelled event falls on the same day as the hero, add a line
  inside the hero: "Maya's 4:00 PM rehearsal today is cancelled."
- **File:** `src/app/(app)/home/page.tsx` (the `next` selection around line 47 and the page layout).

### P0-2 Event notes ("bring…") are hidden on the hero unless the event has been revised
- **Route:** `/home` hero card
- **Problem:** `{ev.revision > 0 && ev.notes ? <p className="text-gold">{ev.notes}</p> : null}`.
  The "Notes for cast & families" field ("Bring a lunch", "Wear character shoes") never shows on an
  unrevised event, and on a revised one the *standing* note is shown in gold as if it were the change
  description. Both read wrong: a kid shows up without character shoes, or a parent reads a standing
  note as news. (The Oct 7 hero shows "Updated: Act 2 Sc 3 moved earlier…" only because the author
  happened to put the change into the notes field.)
- **Fix:** Always show `ev.notes` on the hero (and a 1-line preview on Coming-up cards) with a 📝/info
  icon in normal text color. Show a change description separately and only for changes — ideally a
  dedicated "Note for families about this change" captured in the editor when a published event
  changes (see P1-6); until then, label the badge "Updated Oct 4" with no gold note.
- **File:** `src/app/(app)/home/page.tsx` (hero ~line 290 and `CallCard`); editor
  `src/app/(app)/p/[productionId]/schedule/_components/event-editor.tsx`.

---

## P1 — friction

### P1-1 "Updated" badge is permanent and contentless
- **Route:** `/home`, `/p/[id]/schedule`, family event detail
- **Problem:** `StatusBadges` shows "Updated" whenever `revision > 0`, forever, and doesn't say what
  changed. After a few weeks most cards say "Updated" and families learn to ignore it (badge blindness)
  — so the badge fails exactly when it matters.
- **Fix:** Show "Updated" only for changes within the last 7 days (until per-user seen-state exists),
  and add the date: "Updated Oct 4". Longer term: per-user last-seen revision, and a diff line ("Time
  changed: was 6:00, now 6:30 PM").
- **File:** `src/app/(app)/p/[productionId]/schedule/_components/bits.tsx` (`StatusBadges`),
  `src/app/(app)/home/page.tsx`.

### P1-2 Block time inputs are unreadable at 375px in the event editor
- **Route:** `/p/[id]/schedule/new`, `/p/[id]/schedule/[eventId]/edit` (Jordan)
- **Problem:** Each block row puts number + start time + "–" + end time + three 36px icon buttons
  (up/down/delete) on one line. At 375px the two `type="time"` inputs collapse to ~90px and render as
  "0 ⏱" — the director can't see the block times they're editing. This is the core scheduling control.
- **Fix:** Put the times on their own row (`grid grid-cols-2`, full width), and move up/down/delete to
  the block header row (number + title) or a `⋯` menu. Bonus per guidelines §3: default a new block's
  start to the previous block's end and offer duration chips (30m · 45m · 1h).
- **File:** `src/app/(app)/p/[productionId]/schedule/_components/event-editor.tsx` (~lines 231–260).

### P1-3 Location isn't tappable to open Maps
- **Route:** `/home` hero + cards; family event detail
- **Problem:** The whole card is one `<Link>` to the event; the location is plain text. Parents
  driving to an unfamiliar venue (tech/performances at "Riverside Community Auditorium") must copy the
  address by hand. (On the event detail page it is a link but only 24px tall.)
- **Fix:** On the hero and event detail, render location as its own ≥44px row link to
  `https://maps.apple.com/?q=<encoded>` (works on iOS, falls back to Google Maps elsewhere). Since the
  card is a Link, restructure: card body links to details; the location row is a sibling link, not
  nested.
- **File:** `src/app/(app)/home/page.tsx`, `src/app/(app)/p/[productionId]/schedule/[eventId]/page.tsx`.

### P1-4 Announcements never reach Calls home
- **Route:** `/home` (Dana, Sam)
- **Problem:** "Parking: use the north lot…" and "Off-book for Act 1 by next Monday" exist only on
  Shows → Pirates → Overview, below the upcoming calls. Parents will not go there; the north-lot notice
  is precisely the logistics info they need on rehearsal day.
- **Fix:** On `/home`, below "Coming up" (or above it if posted in the last 48h), show pinned + new
  (≤7 days) announcements for the user's productions, collapsed to title + first line, with "New" badge.
- **File:** `src/app/(app)/home/page.tsx`.

### P1-5 Signed-out deep links lose their destination
- **Route:** any `(app)` route signed out, e.g. `/p/<id>/schedule` → 307 to `/login` (no `next` param)
- **Problem:** A parent tapping a link from an email/text ("see the updated Saturday call") logs in and
  lands on `/home`, not the event.
- **Fix:** `requireUser` redirects to `/login?next=<path>`; login action redirects to a validated
  same-origin `next` after sign-in.
- **File:** `src/lib/auth.ts` (`requireUser`), `src/app/login/*`.

### P1-6 No "note for families" when changing a published event
- **Route:** `/p/[id]/schedule/[eventId]/edit` (Jordan)
- **Problem:** The footer says "Changes to times, places or calls show families an 'Updated' badge",
  but there's nowhere to say *why/what* — so directors overload the standing Notes field (see P0-2).
- **Fix:** When the event is published and a material field changed, show an optional field "Tell
  families what changed (shown on their call)" above Save; store it (e.g. `events.changeNote` or a
  change-log row) and render it on the family card with the Updated badge.
- **File:** `event-editor.tsx`, `schedule/actions.ts`, `src/db/schema.ts` (needs a column — schema
  owner decides).

### P1-7 "Delete" and "Unpublish" sit next to "Cancel event" on a published event
- **Route:** `/p/[id]/schedule/[eventId]` (Jordan)
- **Problem:** The action row is Edit · Unpublish · Cancel event · Duplicate · Print · Delete. Both
  Unpublish and Delete make a published rehearsal silently vanish from families' screens and calendar
  feeds — no "Cancelled" trace — which is worse for families than cancelling. They're one tap (+ a
  browser `confirm()`) away, adjacent to the right action.
- **Fix:** For published events show only **Edit · Cancel event · Duplicate · Print**; move
  Unpublish/Delete into a `⋯ More` menu with copy that recommends cancelling ("Families won't see that
  it was cancelled. Cancel instead?" [Cancel event] [Delete anyway]). Keep Delete prominent only for
  drafts.
- **File:** `src/app/(app)/p/[productionId]/schedule/[eventId]/page.tsx` (~lines 125–170).

### P1-8 Conflicts form defaults to the first child and handles only one day
- **Route:** `/home/conflicts` (Dana)
- **Problem:** "Who" is a `<select>` preselected to **Leo** — a parent reporting Maya's dentist
  appointment can easily submit it for the wrong kid. Only a single date is supported, so a family
  vacation (Nov 26–29) needs four entries. The "Can't make it?" entry on home doesn't prefill from a
  specific call. Also "Conflicts" is creative-team jargon for families.
- **Fix:** Replace the select with large kid chips (Maya / Leo / Both), **no default** when >1 person,
  required. Add an "Until (date)" for multi-day. Put a "Can't make it" link on each call card that
  opens the form prefilled with that event's date/time and kid. Title the family page "Can't make it"
  / "Absences" (keep "Conflicts" for the team).
- **File:** `src/app/(app)/home/conflicts/page.tsx` (+ its form component), `src/app/(app)/home/page.tsx`.

### P1-9 Audition signup asks a minor's family for email twice
- **Route:** `/audition/[slug]` (parent signing up an 11-year-old)
- **Problem:** For under-18s the form requires both the auditioner's "Email" and "Guardian email";
  most parents type their own address twice. Guardian phone is labeled without "(optional)" but isn't
  required.
- **Fix:** Ask **Age first**. If under 18: show the Parent/guardian section (name, email, phone
  optional) and make the auditioner's email **optional** ("Their own email, if they have one"),
  storing the guardian email in the required `email` column when blank. Label "Guardian phone
  (optional)" — or make it required, since it's the day-of contact; pick one and say it.
- **File:** `src/app/audition/[slug]/signup-form.tsx`, `src/app/audition/[slug]/actions.ts`.

### P1-10 Production tab bar: 9 tabs, most off-screen on a phone
- **Route:** `/p/[id]/*` (Jordan, Pat)
- **Problem:** Overview · Schedule · Scenes · Roles · Ca… — Cast, Breakdown, Auditions, Team, Settings
  are past the fold with no scroll hint. The header (back link, title, subtitle, badge, tabs) also takes
  ~210px on every sub-page, pushing the editor's content down.
- **Fix:** Editors: **Schedule · Cast · Scenes · More** (More → Roles, Breakdown, Auditions, Team,
  Settings); put Auditions first while the production is in `auditions` status. Add a fade at the
  overflowing edge. On sub-pages (`/schedule/new`, `/edit`, `/[eventId]`) collapse the header to one
  line (dot + title).
- **File:** `src/app/(app)/p/[productionId]/layout.tsx`, `src/components/production-tabs.tsx`.

### P1-11 Families have to go through a list to reach their one show
- **Route:** bottom tab **Shows** → `/productions` (Dana, Sam)
- **Problem:** Dana is in exactly one production, but Shows opens a list of one card, then the
  production. Two taps for "the full schedule / who's who".
- **Fix:** When the user has exactly one non-closed production *and isn't an editor/admin*, link the
  tab straight to `/p/<id>`; label it with the show ("Pirates") or "My show".
- **File:** `src/app/(app)/layout.tsx`.

### P1-12 Director's home doesn't point at next week's work
- **Route:** `/home` (Jordan)
- **Problem:** Lists the next events per show, but nothing says "8 drafts not published" or "next
  week has 2 drafts". Getting to "plan next week" is Home → Schedule link (fine, 1 tap) → scroll.
- **Fix:** Per show card add a status line: "Next week: 2 published · 2 drafts — Review & publish"
  linking to `/p/<id>/schedule#week-<date>`; and make the schedule page scroll to the first week with
  drafts.
- **File:** `src/app/(app)/home/page.tsx` (creative section), `src/app/(app)/p/[productionId]/schedule/page.tsx`.

---

## P2 — polish

| # | Route | Problem | Fix | File |
|---|---|---|---|---|
| P2-1 | All, bottom tabs | Tab labels are 11px; "My Calls" + 4 tabs is tight. | 12px labels; rename "My Calls"→"Calls", "Account"→"Me". | `src/components/app-nav.tsx`, `src/app/(app)/layout.tsx` |
| P2-2 | `/home` cards | Card header "The Pirates of Penzance · Costum…" truncates the *useful* part (event title). | When the user has one production, drop the production name; otherwise put event title first: "Costume Fittings — Pirates · Pirates of Penzance". | `src/app/(app)/home/page.tsx` |
| P2-3 | `/home` hero | Time has no verb; release time not distinguished. | "Called 6:00 PM · done 9:00 PM" (or keep the range and label it "Called"). Teen view: add "as Frederic". | `src/app/(app)/home/page.tsx` |
| P2-4 | `/home` header | "Monday, October 5 / Hi, Dana / Calls for Leo and Maya" uses ~120px before the hero. | One line: "Leo & Maya's calls"; drop the greeting/date on mobile. | `src/app/(app)/home/page.tsx` |
| P2-5 | `/home` (Pat) | Admin's home says "You're on the creative team." | Use the relation: "You run Riverside Youth Theatre." | `src/app/(app)/home/page.tsx` |
| P2-6 | `/p/[id]/schedule` | A rehearsal that ended tonight still shows under "Upcoming · TODAY". | Treat events whose `endsAt < now` as past (or label "Done"). | `src/app/(app)/p/[productionId]/schedule/page.tsx` |
| P2-7 | `/p/[id]/schedule` week list | No conflict count per event in the week list (only inside the event). | Add "⚠ 1 conflict" to the row meta line. | same |
| P2-8 | Many | Text links used as navigation are 17–22px tall ("← Riverside Youth Theatre", "← Schedule", "Full schedule →", "+ New", call-sheet phone/email links at 16px). | Pad to ≥44px hit area (`py-3 -my-3` or `min-h-11 inline-flex items-center`). | `production` layout, `ui.tsx PageHeader`, event detail call sheet |
| P2-9 | `/audition/[slug]` | Slot buttons in a 2-col grid wrap "10:00–10:20 / AM" onto two lines. | Single-column slot list on <400px, or show "10:00–10:20" with "AM" in the day header. | `src/app/audition/[slug]/signup-form.tsx` |
| P2-10 | `/audition/[slug]` | Optional "Roles & experience" section is fully expanded, doubling form length. | Collapse optional sections behind "Add roles, experience & conflicts (optional)". | same |
| P2-11 | `/productions/new` (Pat) | 10 fields + 11 color swatches up front. | Only Title required visible; dates/venue/color under "More details" (all editable later in Settings). | `src/app/(app)/productions/new/page.tsx` |
| P2-12 | `/invite/[token]` | Button "Create account & join" is generic. | Outcome verb: "See Maya's calls" (guardian), "See my calls" (performer), "Join the team" (staff). | `src/app/invite/[token]/forms.tsx` |
| P2-13 | `/home/calendar` | Good copy, but the home CTA "Add to my calendar" stays forever. | Hide/shrink after the user has subscribed (feed fetched at least once), replace with "Calendar sync on ✓". | `src/app/(app)/home/page.tsx`, calendar feed route |
| P2-14 | `/p/[id]/breakdown` | Grid view is default on phones. | Default to "By scene" under `md`. | `src/app/(app)/p/[productionId]/breakdown/*` |

## Not yet reviewed
Audition management (check-in, callbacks, casting), roles/scenes/cast editors in depth, team and
settings pages, `/admin`, the MCP/API keys page, and form error states (would require submitting into
the shared DB). Next round.
