# Calltime design language

Owner: visual design. Companion to [`docs/ux/GUIDELINES.md`](ux/GUIDELINES.md) (what goes where, words,
behavior). This doc covers **how it looks** and **which component to reach for**.

Live reference: **`/design`** (signed in) renders every component below in the real shell. Check it at
375px and in dark mode (`prefers-color-scheme`) when you change anything shared.

## The feel

A crisp native-quality app with a little backstage character.

- **Calm paper, confident ink.** Warm off-white page (`bg-bg`), white cards (`bg-surface`), near-black ink.
  Dark mode is a deep plum-black, not grey.
- **Curtain violet** (`accent`) is the one action color: primary buttons, selection, focus, active nav.
- **Marquee gold** (`gold`) is the celebratory/highlight color: "Add to calendar", countdowns, "Updated",
  empty-state spotlights. Never for errors or primary actions.
- **Fraunces** (display serif) for titles, call times and big numbers; **Inter** for everything else.
- **Soft depth.** Layered warm shadows, hairline borders, glass chrome (top bar, tab bar, sticky strips).
- **Capsules for actions, rounded rectangles for content.** Buttons/chips/pills are `rounded-full`;
  inputs `rounded-xl` (14px); cards `rounded-2xl` (20px); sheets/tickets `rounded-3xl` (28px).
- **Theater motifs, sparingly:** the ticket stub (`<Ticket>`) for *the* next call, the spotlight wash on
  empty states, the production's own color as a poster wash in its header. One motif per screen, max.

## Tokens (src/app/globals.css)

Use semantic utilities only — never raw hex or Tailwind palette colors (`text-gray-500`, `bg-violet-600`),
or dark mode breaks.

| Role | Utilities | Notes |
|---|---|---|
| Page / card / inset | `bg-bg` · `bg-surface` · `bg-surface-2` · `bg-surface-3` | surface-3 = pressed/skeleton highlight |
| Text | `text-ink` · `text-muted` | muted is AA on bg, surface **and** surface-2 |
| Lines | `border-line` · `border-line-strong` | strong = input borders, dashed outlines |
| Action | `bg-accent` `text-accent-ink` · `bg-accent-hover` · `bg-accent-soft` `text-accent` | |
| Highlight | `text-gold` (text-safe) · `bg-gold-soft` · `bg-gold-bright` + `text-gold-ink` | gold-bright is a fill, never small text on paper |
| Status | `success` · `danger` · `warn`, each with `-soft` | text-{x} on bg-{x}-soft is AA |
| Chrome | `glass` utility · `border-glass-line` · `bg-scrim` | |

Every text/background pair above is ≥ 4.5:1 in both themes. Force a theme with
`<html data-theme="dark|light">` (otherwise it follows the OS).

**Production color**: `production.accentColor` is user-picked, so use it only as a tint
(`color-mix(in oklab, <color> 14%, transparent)`) or a dot/edge — never as a text or button background.

### Type

Body is **16px**. Tailwind's scale is retuned for phones:

| Class | Size / line | Use |
|---|---|---|
| `text-xs` | 13 / 18 | metadata, section labels |
| `text-sm` | 15 / 22 | secondary text (iOS "subhead") |
| `text-base` | 16 / 24 | body, inputs (never smaller — iOS zooms) |
| `text-lg` · `text-xl` | 18 · 21 | card titles |
| `text-2xl` … `text-5xl` | 26 · 32 · 40 · 52 | display (with `font-display`) |

Badges may use 12px; nothing smaller. `font-display` = Fraunces; add `tabular` to any column of times or
counts. Section labels: `<SectionTitle>` (13px caps, tracked). Big section headings: `<Heading>`.

### Elevation, radii, motion

- Shadows: `shadow-xs` (controls) · `shadow-card` (resting cards/lists) · `shadow-raised` (hover, lifted) ·
  `shadow-overlay` (sheets, menus, toasts, tab bar) · `shadow-glow` (accent glow under primary).
- Radii: `rounded-xl` 14 · `rounded-2xl` 20 · `rounded-3xl` 28 · `rounded-full` for actions.
- Motion: `ease-out` (default), `ease-spring` (thumbs, pops). Animations: `animate-fade-in`,
  `animate-rise`, `animate-pop`, `animate-shimmer`. Every route's content fades in (opacity only — so
  fixed children aren't re-parented by a transform). `prefers-reduced-motion` disables all of it globally.
- Focus: one global `:focus-visible` ring (2px accent, 2px offset). Don't remove outlines; don't add your own.

## The shell (you don't build this — know how it behaves)

- **Phones:** compact top bar (logo; turns to glass on scroll; clears the notch in standalone PWA mode) and a
  **floating glass tab bar**. Fixed UI must sit above it: use `bottom-[calc(var(--bottom-chrome)+env(safe-area-inset-bottom)+16px)]`
  — or just use `<Fab>` / `<ActionBar>`, which do. The `<main>` already pads for it.
- **Desktop (≥ md):** left rail (240px) with the user at the bottom; content column max 48rem.
- **Tabs are role-based** (GUIDELINES §1): Calls · Schedule *or* Calendar · Show(s) · Company (org admins) · Me.
  Platform Admin is rail-only on desktop and a shield icon in the phone top bar.
- **Production pages** get a poster header (production color wash, title, status + "Opens in N days") that
  collapses to one line on sub-pages on phones, and a **sticky pill tab strip**: editors see
  Overview · Schedule · Cast · Scenes · More (Auditions moves forward during auditions/planning).
- Don't put page-level `<h1>` padding hacks or your own bottom padding for the tab bar — the shell does it.
- Anything with `data-app-chrome` is hidden when printing.

## Components

Server-safe (import from `@/components/ui`, use anywhere):

```tsx
import { Button, LinkButton, buttonClass, IconButton, Card, List, ListRow, Badge } from "@/components/ui";

<Button>Publish 3 rehearsals</Button>                       // variant: primary | secondary | ghost | soft | gold | danger | danger-solid
<Button variant="secondary" size="sm">Duplicate</Button>   // size: sm (36) | md (44, default) | lg (52)
<LinkButton href="/home/calendar" variant="gold"><CalendarPlus /> Add to my calendar</LinkButton>
<a className={buttonClass("secondary", "w-full")}>…</a>    // buttonClass(variant, className?, size?)
<IconButton label="Print call sheet" variant="secondary"><Printer /></IconButton>  // label → aria-label
<IconLinkButton href="…" label="Edit"><Pencil /></IconLinkButton>
```

Icons inside buttons size themselves — don't add `size-4` to them.

```tsx
<Card>…</Card>                                  // tone: default | accent | gold | inset | outline; padding: none|sm|md|lg; interactive
<CardLink href={`/p/${id}`}>…</CardLink>        // whole card is one tap target
<Ticket accent={production.accentColor} stub={<Location/>}>…the next call…</Ticket>

<List>
  <ListRow href="…" leading={<Avatar name={n} />} title={n} subtitle="Mabel · Daughters" />
  <ListRow leading={<IconTile><CalendarDays /></IconTile>} title="Tue, Oct 7" right={<TimePill size="sm">6:00</TimePill>} />
</List>                                          // chevron shows automatically on links without `right`
```

Calls and people:

```tsx
<CallTime>6:00–7:30 PM</CallTime>                // "CALLED" label + Fraunces time, ≥ 32px. size md|lg|xl; strike for cancelled
<TimePill tone="accent">6:00 PM</TimePill>       // tone: neutral|accent|gold|success|danger|warn|solid; strike
<PersonChip name="Maya" />                        // colored initial + name (color matches Avatar)
<Avatar name="Maya Chen" size="lg" />            // xs|sm|md|lg|xl
<Badge tone="danger"><Ban /> Cancelled</Badge>   // tone + `dot`; always text (+ icon), never color alone
```

Filters and choices:

```tsx
<Chip href="/home" active={!filter}>Everyone</Chip>
<Chip href={`/home?p=${id}`} color={personColor(name)} count={3}>Maya</Chip>
<ChipToggle name="duration" value="45" label="45m" type="radio" defaultChecked />  // real input — works in forms, no JS
<SegmentedLinks items={[{ href: "?v=week", label: "Week", active: true }, { href: "?v=month", label: "Month" }]} />
```

Forms (labels above, one column, 16px inputs):

```tsx
<Field label="Rehearsal title" optional hint="Families see this on their call card.">
  <Input name="title" />
</Field>
<Field label="Email" error={state.errors?.email}>
  <Input type="email" name="email" autoComplete="email" aria-invalid={!!state.errors?.email} />
</Field>
<Select>…</Select>  <Textarea />
<Checkbox name="notify" label="Notify families" description="Sends to 31 people" />
<Switch name="sync" label="Calendar sync" defaultChecked />
<Button type="submit" disabled={pending} className="w-full sm:w-auto">{pending ? <><Spinner className="size-4" /> Saving…</> : "Save rehearsal"}</Button>
```

Page structure and states:

```tsx
<PageHeader title="Scenes" subtitle="In show order" back={{ href: base, label: "Overview" }} actions={<Button>Add scene</Button>} />
<BackLink href="…" label="Schedule" />
<SectionTitle action={<LinkButton variant="ghost" size="sm" href="…">See all</LinkButton>}>This week</SectionTitle>
<Heading>Coming up</Heading>
<Notice tone="warn" title="2 changes" action={<Button size="sm" variant="secondary">Review</Button>}>Thu rehearsal cancelled</Notice>
<EmptyState icon={<CalendarDays />} title="No calls yet for Maya" body="When the director publishes…" action={…} />
<Stat label="Called" value={23} hint="first call 6:00" icon={<UsersRound />} tone="accent" href="…" />
<Skeleton className="h-6 w-40" />  <SkeletonCard lines={3} />   // in loading.tsx, shaped like the content
<Divider label="or" />
```

Floating and overflow:

```tsx
<Fab href={`${base}/schedule/new`} label="New rehearsal" icon={<Plus />} />       // `extended` shows the label
<ActionBar><span className="flex-1 pl-2">3 drafts this week</span><Button>Review & publish</Button></ActionBar>  // add pb-24 to the page
<Menu id="week-actions" label="Week actions">                                     // native popover, zero JS
  <MenuItem href="…" icon={<Copy />}>Duplicate last week</MenuItem>
  <form action={publishAll}><MenuItem type="submit" icon={<Send />}>Publish all drafts</MenuItem></form>
</Menu>
```

Client components (separate files; importable from server components):

```tsx
import { Sheet, SheetClose } from "@/components/sheet";
<Sheet trigger={<Button variant="soft"><Plus /> Add block</Button>} title="Add block"
       footer={<><SheetClose variant="ghost">Cancel</SheetClose><Button form="add-block">Add 2 scenes</Button></>}>
  <form id="add-block" action={addBlock}>…</form>
</Sheet>
// Controlled from a client component: <Sheet open={open} onOpenChange={setOpen} title="…" closeOnSubmit>

import { SegmentedControl } from "@/components/segmented-control";
<SegmentedControl name="target" options={[{ value: "scenes", label: "Scenes" }, { value: "people", label: "People" }]} />

import { Tabs, NavTabs } from "@/components/tabs";
<Tabs items={[{ value: "scenes", label: "Scenes", count: 14, content: <ScenePicker /> }, …]} />  // in-page panels
<NavTabs tabs={[{ href: "/org", label: "People" }, …]} exact="/org" />                         // route tabs (+ `more`, `sticky`)

import { toast, FlashToast } from "@/components/toast";
toast("Published. 31 people notified.", { tone: "success" });
toast("Block removed", { action: { label: "Undo", onClick: undo } });   // 8s when there's an action
<FlashToast message="Invite sent" />   // from a server page after redirect (?sent=1)

import { CopyButton } from "@/components/copy-button";   // copy / native share
```

## Composing a screen

1. **One hero per screen.** On Calls it's the next call (`Ticket` + `CallTime`); on a dashboard a row of
   `Stat`s; on a list screen the list itself. Don't stack three equally loud cards.
2. **Grouped lists over card soup.** Many similar items → one `List` of `ListRow`s with a `SectionTitle`
   per group, not a card per item.
3. **Spacing rhythm:** 4/8/12/16/24/32. Inside cards `p-4` (`p-5`–`p-6` for forms); between cards
   `space-y-3` / `gap-3`; between sections let `SectionTitle`/`Heading` handle it (mt-8 / mt-10).
4. **One primary button per view.** Secondary actions are `secondary`/`ghost`, or in a `Menu`.
   Destructive actions use `danger` and the specific verb; in dialogs never the default/right-most.
5. **Phones first:** at 375px nothing scrolls sideways, primary actions are full-width (`w-full sm:w-auto`),
   tap targets ≥ 44px (all components already are), filters scroll horizontally in a
   `-mx-4 px-4 flex gap-2 overflow-x-auto scrollbar-none` row.
6. **Every state:** loading (`Skeleton` in `loading.tsx`), empty (`EmptyState` with icon + one action),
   error (`Notice tone="danger"`), success (toast or inline `Notice tone="success"`).
7. **Color is never the only signal** — pair with a word and/or icon (Cancelled = badge + strike + icon).

## Don'ts

- Raw colors, `shadow-lg`/`shadow-md` (use the elevation tokens), `rounded-md` cards, text under 12px.
- New one-off button styles — extend `buttonClass` instead.
- Spinners for whole pages; modals for things a `Sheet` or inline edit can do.
- `position: fixed` bottom UI without `--bottom-chrome` (it'll hide under the tab bar).
- Gold text on paper with `text-gold-bright` (fails contrast) — use `text-gold`.

## App icon & PWA

`src/app/icon.svg` (favicon), `src/app/apple-icon.png` (180, full-bleed), `public/icons/` (192/512 "any" +
maskable), `src/app/manifest.ts` (standalone, starts at `/home`). The mark is a white "C" clock with a gold
hand and a marquee bulb on a curtain-violet gradient; `<LogoMark>` and `<Wordmark>` render it in-app.
