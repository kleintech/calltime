# Calltime UX guidelines

Owner: UX. Audience: the people building screens. Visual design (tokens, components, look) is owned
separately — this doc covers **what goes where, in what order, with what words, and how it behaves**.
Every section ends in a checklist; verify your screen against it before calling it done.

The product promise, which every decision is judged against:

> Open the app → instantly know **when and where my kid is called**. It's already in my phone
> calendar. I never read a chat feed again.

If a screen makes a parent scroll, interpret, or tap to answer "when do I drop off and pick up?",
it is wrong, however pretty it is.

---

## 0. Universal rules (apply to every screen)

### Words
- Say **"Called 6:00–7:30 PM"**, not "Call: 18:00", "6p-7:30p", or "Block 2".
- Always answer **who / when / where** in that order on any call: *Maya · Tue Oct 7 · Called
  6:00–7:30 PM · Main Stage*.
- Day names first, then date: **"Tue, Oct 7"**. Use **"Today"** and **"Tomorrow"** instead of the
  date when true (keep the date in smaller text after: "Tomorrow · Oct 7").
- Times: 12-hour with AM/PM in US orgs (`fmtTime` in the org's timezone). Ranges with an en dash and
  one AM/PM if both share it: "6:00–7:30 PM". Never show seconds or timezone abbreviations unless the
  viewer's device timezone differs from the org's (then add "(Eastern)").
- Theater words we keep (they're the users' own language): **call, called, released, rehearsal,
  tech, dress, ensemble, understudy, callback**. Words we explain or replace for families:
  | Internal / jargon | Show families | Show creative team |
  |---|---|---|
  | Block | (hide — show the time slice and what's being worked on) | "Block" OK |
  | Breakdown | — | "Breakdown" + subtitle "Who's in each scene" |
  | Role group | — | "Group" (e.g. "Pirates") |
  | Draft / Published | — | "Draft (only the team can see this)" / "Published — families can see it" |
  | Conflict | "Can't make it" / "Absences" | "Conflicts" |
  | Revision / updated | "Changed" + what changed | "Updated" |
  | Release | "Done at 7:30" / "Pick up 7:30" | "Released 7:30" |
  | all_cast | "Full cast" | "Full cast" |
  | Swing | — | "Swing" |
- Buttons are verbs that say the outcome: "Publish 3 rehearsals", "Add to my calendar",
  "Send invite link". Never "Submit", "OK", "Confirm", "Save changes" when something more specific fits.
- No exclamation-point cheerleading in errors. Warm but brief in empty states.

### Touch, type, and contrast
- [ ] Every tap target ≥ 44×44 px (Button/Input already `min-h-11`; icon-only buttons need padding to match). 8px min gap between adjacent targets.
- [ ] Body text ≥ 16px on any screen a parent/performer sees. 14px only for secondary metadata; 12px only for badges. **Bottom-tab labels at 11px are too small — use 12px min.**
- [ ] **Form inputs must render at 16px font size** — iOS Safari zooms the page on focus for anything smaller, which disorients parents. Check `Input`, `Select`, `Textarea`.
- [ ] Layout survives 200% text zoom / large Dynamic Type: no fixed heights on text containers, times wrap rather than truncate, no text inside images.
- [ ] Contrast ≥ 4.5:1 for text, 3:1 for icons/borders that carry meaning. Check `text-muted` on `bg-surface-2` especially.
- [ ] **Color is never the only signal.** "Cancelled" = strikethrough + word + icon. "Changed" = word + icon. Kid identity = name/initial + color. Conflict = icon + text.
- [ ] Every icon-only control has an `aria-label`; tabs use `aria-current="page"`.
- [ ] Focus visible on all interactive elements; logical tab order; no focus traps except open dialogs.
- [ ] Nothing important only on hover (phones have no hover).
- [ ] Respect `prefers-reduced-motion`.
- [ ] Single-column forms; labels above inputs; never placeholder-as-label.

### Forms
- [ ] Ask for the minimum. Every field must justify itself ("would we block signup without it?"). Optional fields marked "(optional)"; required ones not starred-and-scary.
- [ ] Correct `type`/`inputMode`/`autoComplete`: `email`, `tel`, `given-name`, `family-name`, `one-time-code`, `new-password`; `inputMode="numeric"` for age.
- [ ] Prefill everything we already know (invite email/name, org default location, last-used rehearsal times).
- [ ] Validate on submit (and on blur after first submit), not on every keystroke. Errors inline under the field, in plain words ("Enter an email like name@example.com"), plus a summary at top that focuses on submit for screen readers.
- [ ] Submit button shows pending state ("Saving…") and is disabled while pending — no double submissions.
- [ ] Never lose typed input on a server error. Re-render with values kept.
- [ ] Primary action is the last thing in the form, full-width on mobile, and not hidden behind the on-screen keyboard (sticky footer on long forms).

### Loading, empty, error
- [ ] Loading: skeletons shaped like the content (`loading.tsx`) for anything > 300ms. Never a blank white screen; never a spinner for the whole page.
- [ ] Empty: say what this area is for, why it's empty, and the one next action. ("No rehearsals yet. When the director publishes the schedule, Maya's calls show up here.")
- [ ] Error: what happened + what to do + a way out (Retry / back). Never a raw stack or "Something went wrong" alone. 404/forbidden pages link back to My Calls.
- [ ] After any mutation: visible confirmation in context (inline "Saved" or toast with **Undo** where possible), and the screen reflects the new state immediately.

### Destructive actions
- [ ] Prefer **Undo** (toast, ~8s) over confirmation for cheap reversible things: removing a person from a block, deleting a block, removing a scene from a block.
- [ ] Confirm (dialog naming the object and consequence) for things that notify or are hard to reverse: **cancel a published rehearsal** ("Cancel Tue Oct 7 rehearsal? 23 families will see it as cancelled."), delete a production, remove a person from the company, revoke an invite/API key, un-cast someone.
- [ ] Destructive buttons use the `danger` variant and the specific verb ("Cancel rehearsal", "Delete scene"), and are never the default/primary-position button in the dialog.
- [ ] Published events are **cancelled, not deleted** (families must see the cancellation). Only drafts can be deleted.

---

## 1. Navigation & information architecture

### Principle
Families have **one job** (see calls). The creative team has **one frequent job** (build/adjust the
schedule) and many occasional ones (roles, scenes, cast). The admin has occasional setup jobs. The
nav should reflect frequency, not the data model.

### Bottom tabs by role (mobile)
Max 4 tabs. Tabs are computed from what the user *is*, and the first tab is always the screen that
answers their most frequent question.

| User | Tab 1 (lands here) | Tab 2 | Tab 3 | Tab 4 |
|---|---|---|---|---|
| Parent / guardian | **Calls** (`/home`) | **Calendar** (`/home/calendar` — subscribe status + month view) | **Show** (the current production, read-only: announcements, cast, full schedule) | **Me** (account, kids, absences) |
| Performer (teen) | **Calls** | **Calendar** | **Show** | **Me** |
| Creative team (also often a parent) | **Calls** (own/kids' calls if any, else "This week" for their shows) | **Schedule** (direct link to the current production's schedule, week view) | **Show** (production hub: scenes, roles, cast, breakdown, auditions, team) | **Me** |
| Org admin | **Calls** (if they have any) else **Shows** | **Shows** | **Company** (`/org`) | **Me** |
| Platform admin | add **Admin** inside **Me**, not a tab | | | |

Notes for builders (`src/app/(app)/layout.tsx`, `src/components/app-nav.tsx`):
- [ ] Rename "My Calls" → **"Calls"** (short label, fits at 12px; the screen title can still say "My calls" / "Maya & Leo's calls").
- [ ] Rename "Shows" for families → it should open **directly to the current production** when the user has exactly one active production, not a list of one.
- [ ] "Account" → **"Me"**. Platform "Admin" lives inside Me (it's for ~1 person).
- [ ] Never show a tab that leads to an empty or forbidden page for this user (no "Company" for non-admins — already done; keep it that way).
- [ ] Active tab: color **and** heavier icon stroke **and** `aria-current`.
- [ ] If a user has 2+ active productions, Schedule/Show tabs open a production switcher sheet (most recent first), remembering the last choice.

### Production tabs (`src/app/(app)/p/[productionId]/layout.tsx`)
Nine horizontally scrolling tabs on a phone is too many — the ones past the fold effectively don't exist.
- [ ] Editors: **Schedule · Cast · Scenes · More**. "More" holds Roles, Breakdown, Auditions, Team, Settings. Order by frequency of use during rehearsal season. During `auditions` status, put **Auditions** in position 1 instead of Schedule.
- [ ] Merge "Overview" into the top of Schedule for editors (this week + needs-attention items), or make Overview a real dashboard (see §5) — don't keep a tab that's a dead end.
- [ ] Families: **Schedule · Cast & Team · Announcements**. No Overview tab unless it has content they need.
- [ ] Production tabs must be visibly scrollable if they overflow (fade edge) and keep the active tab scrolled into view.
- [ ] The production header is tall (back link + title + subtitle + badge). On mobile collapse it to one line (dot + title) on sub-pages so the content starts above the fold.

### The director's "build next week" path — ≤ 2 taps
- From anywhere: **Schedule tab** (1) → lands on the current production's **schedule week view, defaulting to the week that needs work** (next week if this week is fully published) with a primary **"Plan next week"** button / **"+"** FAB (2).
- From Calls home, a creative-team member sees a card: **"Next week: 0 of 3 rehearsals published — Plan it"** linking straight into the editor for that week.
- [ ] Verify: from a cold app open, tap count to "editing a rehearsal for next Tuesday" ≤ 2.

### Global checklist
- [ ] Every screen has a page title that says what it is in plain words.
- [ ] Back affordance on every non-tab screen (top-left "‹ Schedule"), preserving scroll/filters of the parent.
- [ ] Deep links work signed-out: they go to login, then **return to the deep link**, not to /home.
- [ ] The URL for a single call/event is shareable within the team.

---

## 2. Calls home (`/home`) — the most important screen

### Hierarchy (top to bottom, mobile)
1. **Alert strip — only if something changed or was cancelled since the user last looked**
   (see "Changes" below). This goes *above* the hero. It is the only thing allowed above the hero.
2. **Hero: the next call.** If there are calls today, the hero is today's.
3. **"Add to your calendar" setup card** — until they've subscribed (dismissible after subscribing, never before first visit to the calendar page).
4. **This week** — compact list of remaining calls this week, grouped by day.
5. **Later** — next 2–3 weeks, grouped by week, collapsed beyond that ("Show more").
6. Pinned announcements (max 1–2, collapsed to title + first line) — *below* calls, never above.
7. "Can't make a rehearsal? Tell the team" entry (conflicts) — a quiet row, not a card.

No production-marketing, no stats, no "welcome back" banner above the hero.

### Hero card (next call)
```
┌─────────────────────────────────────────┐
│ TOMORROW · TUE OCT 7          (●Maya)   │  ← day label (Today/Tomorrow/weekday) + kid chip(s)
│ Called 6:00 – 7:30 PM                   │  ← biggest text on screen (≥28px)
│ Main Stage, Riverside Community Ctr  ↗  │  ← location, taps to Maps
│ Pirates of Penzance · Rehearsal         │  ← production + kind
│ Act 1 Sc 2 "Pour, O pour" · Pirates     │  ← what they're working on (reasons)
│ [ Details ]   [ Can't make it ]         │
└─────────────────────────────────────────┘
```
- [ ] Time range is the most prominent element. Call **and** release time (parents plan pickup by the release).
- [ ] "Today" calls in the hero show relative time when < 3h: "Starts in 45 min".
- [ ] Location is a link to native maps (`https://maps.apple.com/?q=` works on iOS and falls back on Android) with the room/block location if different from the event.
- [ ] If the person is called for a different window than the whole event (e.g. event 4–9, Maya 6–7:30), show **only her window** big; event hours in small text in Details.
- [ ] Event notes ("bring character shoes") show as a one-line preview on the hero with an icon, full in Details.
- [ ] Performances/tech/dress get a distinct label and icon ("Performance", "Tech rehearsal") — they matter more to families than regular rehearsals.
- [ ] Not called but the production has a rehearsal today: show **"Maya isn't called today"** in the This-week list for that day (families get anxious when unsure; explicit "not called" removes a text to the stage manager). Do not show these as hero.

### Multiple kids (Dana: Maya & Leo)
- [ ] Each person gets a **stable chip: initial avatar + first name + a per-person color** (assign deterministically by person id from a 6-color palette that's distinguishable for color-blind users; the name is always present, the color is a redundant cue).
- [ ] When two kids are called to the **same event**, show **one card** with both chips and **each kid's own times** on separate lines if they differ:
  `Maya  Called 6:00–7:30 PM` / `Leo  Called 6:45–8:00 PM`. Hero time = earliest call, with "Pick up: Maya 7:30 · Leo 8:00".
- [ ] When kids are in different productions at overlapping times, show both cards and an inline **"Overlaps with Leo's call"** note — that's a car-logistics problem the parent needs to see.
- [ ] Filter chips at top only when ≥2 people: **All · Maya · Leo** (default All). Remember the selection per device.
- [ ] A parent who is *also* a performer/creative sees themselves as one more chip ("You").
- [ ] Title reflects who: "Maya & Leo's calls" (2), "Your family's calls" (3+), "Your calls" (self only).

### Changes and cancellations — impossible to miss
The whole reason families left the chat feed is "I missed the message that it moved." So:
- [ ] **Alert strip at top** when any upcoming call changed or was cancelled since the user last viewed it (track last-seen revision per user+event; until that exists, use "changed in the last 72h"):
  `⚠ 2 changes · Thu rehearsal cancelled · Sat call moved to 10:00 AM  [Review]`. Tapping scrolls to / lists them. Stays until viewed.
- [ ] **Cancelled** card: the word **CANCELLED** as a badge (danger tone) + strikethrough on the time + an icon + "Cancelled by the director on Oct 3" — still listed in place so the parent sees the slot is free. Never silently remove a cancelled event.
- [ ] **Changed** card: "Changed" badge (warn tone) + **what changed in words, old → new**: "Time changed: was 6:00, now **6:30 PM**", "Location changed: now Rehearsal Room B", "Leo added to this rehearsal". If we can't compute the diff yet, at minimum "Updated Oct 4 at 3:12 PM".
- [ ] Badge persists until the user has seen the card (or 7 days), not just until the next revision.
- [ ] Newly **added** calls (new rehearsal published) also get a "New" badge.
- [ ] Changes inside the next 48h are emphasized more strongly (in the hero / alert) than changes 3 weeks out.
- [ ] The calendar feed must carry the same info: SEQUENCE bump, and title prefix `CANCELLED: ` for cancelled events (many calendar apps hide STATUS:CANCELLED).

### Details (event detail for a family)
- [ ] Route like `/home/calls/[eventId]` or `/p/[id]/schedule/[eventId]` — shows only the blocks *their* kid is in, in time order: `6:00–6:45 Act 1 Sc 2 · with Choreographer · Studio B`. A toggle "See full rehearsal plan" for the curious.
- [ ] Notes, location with map link, "Add this one to calendar" (single .ics) for people who won't subscribe, "Can't make it" action.
- [ ] Who to contact: stage manager name + tap-to-email/text if the org allows.

### Empty states
- [ ] **No people linked** (account exists but not attached to any performer): "We can't find a performer linked to your account. Ask your director for an invite link, or [enter a code]." — and tell them which email they're signed in as.
- [ ] **Linked, cast, no published calls yet**: "No calls yet for Maya. When the director publishes the rehearsal schedule, calls show up here and in your calendar." + the calendar setup card (so they're ready before calls exist).
- [ ] **In auditions only**: show audition/callback slot as the hero ("Audition Sat Oct 11 · 10:20 AM") — same card shape.
- [ ] **Show is over**: "That's a wrap on Pirates! 🎭 Calls for your next show will appear here." — no dead list of past events. Past calls under a "Past" link at the bottom.
- [ ] **Nothing this week but things later**: "No calls this week" row in This week, Later still shows.

### First-run onboarding (subscribe to calendar)
The calendar subscription is the feature that makes the app disappear into their life; push it hard
once, then get out of the way.
- [ ] First visit to `/home` after accepting an invite: a full-width card above This-week (below hero):
  **"Get Maya's calls in your phone's calendar"** · "Updates automatically when the schedule changes." · [**Add to iPhone Calendar**] (webcal:// link) / [**Add to Google Calendar**] / "Other calendar app" (copy link). Detect platform and put the right button first.
- [ ] After tapping, show "Did it work? You should see a 'Calltime – Maya & Leo' calendar." with [Yes, done] / [Show me how] (short illustrated steps). [Yes, done] dismisses the card for good.
- [ ] One feed per *user* covering all their kids (one subscribe action, not one per kid); per-kid feeds available under "More options" for split-custody households.
- [ ] Calendar event titles must be self-explanatory out of context: **"Maya: Pirates rehearsal (called 6:00–7:30)"** — event start/end = her call/release, location filled, description lists the scenes and notes and a link back.
- [ ] Never show the raw feed URL as the primary affordance; explain it's private ("Anyone with this link can see the schedule — don't post it").

### Calls home checklist
- [ ] A parent with two kids can state the next drop-off time, pickup time and place within 3 seconds of opening.
- [ ] Changes/cancellations since last visit are visible without scrolling.
- [ ] Every card names the kid.
- [ ] Works with JS disabled for reading (server-rendered).
- [ ] Pull-to-refresh not required to see a change (data is fresh on navigation).

---

## 3. Schedule builder (creative team, on a phone)

### Mental model
Directors think: *"Tuesday 6–9. First hour, Act 1 Scene 2 with the choreographer in the studio;
then Pirates for the music director; last 30 min full cast run."* The UI should accept exactly that:
**event (date, time, place) → blocks (time slice) → who (scenes first)**.

### Week view (`/p/[id]/schedule`)
- [ ] Default to a **week list** (Mon–Sun rows), not a month grid. Week switcher ‹ This week › at top; "Next week" one tap away.
- [ ] Each event row: day, time, kind, title, status pill (**Draft** grey-dashed / **Published** / **Cancelled**), count "18 called", and a **conflict count** ⚠ 2 if any.
- [ ] Days with nothing show a faint "+ Add rehearsal" row so the empty slot *is* the button.
- [ ] Sticky footer when drafts exist in view: **"3 drafts this week — Review & publish"**.
- [ ] Week actions (overflow menu): **Duplicate last week**, **Copy this week to…**, **Publish all drafts**, **Print/share call sheet**.

### Fastest way to create a rehearsal
- [ ] "+ Add rehearsal" on a day prefills: that date, the production's **most common start/end time** (or last used), default location, kind=Rehearsal, title auto ("Rehearsal"). Creating it should need **zero typing** — one tap "Create" lands in the event editor.
- [ ] **Duplicate** on any event (and "Duplicate to next week" one-tap) copies blocks and calls.
- [ ] **Templates**: "Save as template" from an event ("Typical Tue/Thu"), and "Start from template" when creating. Lower priority than duplicate — duplicate covers 80%.
- [ ] Time inputs: native `<input type="time">` with 15-minute `step`; durations offered as chips (30m · 45m · 1h · 1.5h) when adding a block, with the next block's start = previous block's end automatically.

### Calling scenes into a block
- [ ] "Add block" opens a bottom sheet with the time (prefilled, sequential) and a **picker with tabs: Scenes (default) · Groups · Roles · People · Full cast**.
- [ ] Scenes list in show order, labeled "Act 1 · Sc 2 — Pour, O pour" with the **headcount** ("12 people") and a **conflict indicator** if any of those people are unavailable in this time.
- [ ] Multi-select with checkboxes, sticky "Add 2 scenes" button. Search box at top for long shows.
- [ ] Optional fields collapsed under "More": title, led by (Choreographer / Music Director chips from the creative team), room, notes.
- [ ] Block card after adding: `6:00–6:45 · Act 1 Sc 2, Sc 3 · Choreo · Studio B` + "14 called · ⚠ 1".

### Who's called and conflicts — without overwhelming
- [ ] Event editor shows a **summary line**: "23 people called · first call 6:00 · ⚠ 2 conflicts". Tap → **Call sheet** view: list of people sorted by call time with their window ("Maya — 6:00–7:30"), minors' guardians reachable.
- [ ] Conflicts shown **only where they matter**: on the block that overlaps the conflict, as `⚠ Ava (out until 6:30 — "dentist")`. Don't list all production conflicts in the editor.
- [ ] Conflicts are **warnings, never blockers** — directors often call someone anyway. Offer "Call anyway" implicitly (no modal), but show it on the call sheet.
- [ ] Understudy nuance (scene calls skip understudies) explained once in the picker: "Scenes call the primary cast. To include understudies, call the role."
- [ ] The **Breakdown** (scene × role matrix) is a separate creative-team screen; don't embed it in the editor. Link "Edit who's in this scene" from the scene row.

### Publish flow
- [ ] New events are **Draft** — clearly labeled "Draft — only the team can see this" at the top of the editor.
- [ ] **Publish** button on the event and "Publish all drafts" on the week. Before publishing, a sheet summarizes: "Publish 3 rehearsals (Oct 13–17)? 31 people will see their calls. Families with calendar sync get them automatically." [Publish] [Not yet].
- [ ] Editing a **published** event: a persistent banner "This rehearsal is published. Changes are visible to families right away." Material changes (time, location, who's called, cancel) **save immediately but are flagged as changes** on families' screens (see §2). Optional "Add a note for families about this change" field appears after a material change — that note shows on the family's "Changed" card.
- [ ] (Better, later) Batch changes: "You have unpublished changes to a published rehearsal — [Publish changes]" so a director can fix three things and families see one change, not three. If implemented, drafts-of-changes must be visually unmistakable.
- [ ] **Cancel** (not delete) a published event: confirmation naming the number of people affected; optional reason shown to families.
- [ ] After publishing: toast "Published. 31 people notified." with **View as family** link (renders the Calls card as Dana would see it — this builds trust).

### Schedule builder checklist
- [ ] Create + call 2 scenes + publish a rehearsal on a 375px phone in ≤ 60 seconds and ≤ 10 taps, with no typing.
- [ ] Duplicate last week into next week in ≤ 3 taps.
- [ ] Draft vs published vs cancelled distinguishable without color.
- [ ] No horizontal scrolling in the editor at 375px.
- [ ] Undo available for block delete and call removal.

---

## 4. Invites and onboarding

### Parent from a texted link → seeing their kid's calls in < 60s
Typical message: *"Join Riverside Youth Theatre on Calltime to see Maya's rehearsal calls: calltime.app/invite/abc123"*.

`/invite/[token]` for a **new** user:
- [ ] Top: who invited them and why, in their words: **"Riverside Youth Theatre invited you to see Maya's rehearsal calls for *Pirates of Penzance*."** (Org name, kid's first name, production.) No product marketing.
- [ ] Fields: **Your name** (prefilled from invite if known), **Email** (prefilled, editable? — prefilled + read-only is fine if the invite is email-bound; otherwise editable), **Create a password** (show/hide toggle, `autoComplete="new-password"`, minimum length stated up front, no composition rules). That's it. No phone, no address, no kid details — the kid already exists.
- [ ] One button: **"See Maya's calls"**. On success land on `/home` with the calendar onboarding card visible.
- [ ] If the email already has an account: "You already have a Calltime account — sign in to add Maya" with the password field only (and "Forgot password?"). Accepting attaches the guardianship; land on `/home`.
- [ ] If already signed in as the right person: one-tap "Add Maya to my account". If signed in as **someone else** (shared family iPad): "You're signed in as Sam. [Accept as Sam] [Use a different account]" — never silently attach to the wrong account.
- [ ] Expired/used link: "This invite link has expired. Ask Riverside Youth Theatre's stage manager for a new one." + sign-in link (they may already be set up). Name the org; never just "Invalid token".
- [ ] Should a second guardian need access, the invite is per-guardian; Me → Kids → "Invite another parent/guardian" generates a share link they can text themselves (guardians, not admins, do this work).
- [ ] Measure: invite open → calls visible ≤ 3 screens, ≤ 4 fields.

### Kids/teens with their own account (Sam)
- [ ] Invite copy addresses the teen: "You've been cast as **Frederic**! Join to see your rehearsal calls."
- [ ] Same minimal fields. Teens expect **"Sign in with Apple/Google"** — add when feasible; it's the biggest friction reducer for both teens and parents.
- [ ] Teen home is the same Calls screen, single person; title "Your calls". Hero can show role ("as Frederic").
- [ ] Teens can report their own conflicts; guardians can see/edit them too.

### Staff invites (creative team, admins)
- [ ] Invite screen copy states the seat: "Jordan invited you to join *Pirates of Penzance* as **Choreographer**."
- [ ] After acceptance, land on the production's Schedule (not empty Calls).

### Creating invites (admin / creative team side)
- [ ] From a person row: **"Invite guardian"** / **"Invite performer"** → creates link → native **Share sheet** (`navigator.share`) with a prewritten message, with **Copy link** fallback. Email delivery optional.
- [ ] Prewritten text includes the kid's name and production (see above). Editable before sharing.
- [ ] Pending invites list shows status (Sent · Opened? · Accepted), with Resend/Copy/Revoke.
- [ ] Bulk: "Invite all guardians who haven't joined (12)" → produces a list of personalized links to copy, or emails.

---

## 5. Creative team & admin setup screens (productions, scenes, roles, cast, breakdown, team)

Lower frequency, so clarity > speed, but still phone-usable.
- [ ] **Production overview for editors** = a setup checklist until done, then a dashboard:
  "① Add roles (12) ✓ ② Add scenes (14) ✓ ③ Who's in each scene (Breakdown) — 3 scenes empty ④ Cast roles — 4 roles uncast ⑤ Invite families — 18 of 31 joined ⑥ Build the schedule". Each step links to its screen. This is the onboarding for admin Pat and director Jordan.
- [ ] Roles: grouped by kind (Leads, Supporting, Featured, Ensemble); each row shows who's cast ("Maya Chen · u/s Ava") or **"Not cast"** in warn tone.
- [ ] Scenes: in show order (Act, Number), with role count; drag-to-reorder on desktop, up/down buttons on mobile; "Add scene" keeps the sheet open for rapid entry ("Add & next").
- [ ] **Breakdown** subtitle: *"Who's in each scene — this decides who gets called when you schedule a scene."* On mobile: one scene at a time with role checkboxes (scene picker at top); on desktop: the matrix. Never a 14×30 grid on a phone.
- [ ] Cast: list of people with roles; "Add person" asks first name, last name, **"Under 18?"** toggle → if yes, guardian name + email/phone (to send the invite). Person detail shows "Account: Not joined — [Invite]".
- [ ] Team: creative team seats with titles; invite by link.
- [ ] Bulk entry where lists are long (paste a list of names / roles one per line).

---

## 6. Auditions — public signup (`/audition/[slug]`), parent on a phone

Signed-out, arrives from a flyer QR code or Facebook post.
- [ ] Header: production, org, **dates, place, what to prepare** (description) — collapsed to 3 lines with "More".
- [ ] **Step 1 — pick a time**: slots grouped by day, each a large tappable row "10:00–10:20 AM · 3 spots left"; full slots shown disabled with "Full" (so they know it existed). If only one slot/day, skip the step.
- [ ] **Step 2 — about the performer**: First name, Last name, **Age** (numeric). If age < 18 (or "Under 18?" yes) the form **reveals Parent/guardian name, email, phone** and the performer's own email becomes optional. If adult, performer email + phone (phone optional).
- [ ] The schema requires `email` on the signup: for minors, **use the guardian email** for that column rather than asking twice.
- [ ] Optional section collapsed by default: "Roles you're interested in", "Experience", "Rehearsal conflicts" (with helper "List dates you already know you can't make"), custom questions. Required custom questions shown expanded.
- [ ] One button: **"Sign up for Sat 10:00 AM"** (echo the choice).
- [ ] Confirmation page: big ✓, the time, place, what to bring, **[Add to calendar]** (.ics), "We sent a confirmation to dana@…" (if email exists), and **"Signing up another child? [Add another]"** that keeps guardian info prefilled.
- [ ] Siblings: the "add another" path must not require retyping guardian fields.
- [ ] Closed audition: "Signups for *Midsummer* are closed. Contact …" — not a 404.
- [ ] No account creation required to sign up. Callback/cast notifications can later invite them to create one.
- [ ] Error: slot filled while they were typing → keep all their input, highlight "That time just filled up — pick another", show remaining slots.

### Audition management (creative team)
- [ ] Check-in view for audition day: big list sorted by slot time, one tap **Check in**; search by name.
- [ ] Callbacks: select signups → "Invite to callback" → choose callback slot; families see it on their screen / get emailed.
- [ ] Casting: from a signup, "Cast as…" role picker → creates the person + assignment; explicit confirmation summary before finalizing a cast list. Never show "not cast" status to families without a deliberate "Notify" step by staff.

---

## 7. Conflicts ("Can't make it")

- [ ] Family side: "Can't make it" from a call card prefills that event's date/time window; also a general "Add an absence" with date + all day / time range + optional reason ("dentist"). Choose which kid if multiple.
- [ ] Copy: "The director will see this when planning. It doesn't excuse you automatically — check with your stage manager." (sets expectations).
- [ ] List of my absences with delete (undo).
- [ ] Creative side: see §3 — surfaced per block, not a firehose.

---

## 8. Account / Me
- [ ] Order: My kids (with each kid's productions & roles) → Calendar sync status → Notifications (when exist) → Account (name, email, password) → Sign out (bottom, not destructive-red).
- [ ] "Sign out" doesn't need confirmation. "Delete account" does, and explains what happens to kids' data.
- [ ] Platform admin link lives here.

---

## 9. Review checklist for any PR touching a screen
- [ ] Tested at 375×812 and at desktop width.
- [ ] Tested as each role that can reach it (parent, teen, director, admin).
- [ ] Empty, loading, error states exist and read well.
- [ ] Copy reviewed against §0 table (no "block", "breakdown", "revision", "target" leaking to families).
- [ ] No action a parent needs is more than 2 taps from Calls.
- [ ] Changes/cancellations visible to families with words, not just color.
