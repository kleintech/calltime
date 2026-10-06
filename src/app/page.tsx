import { eq } from "drizzle-orm";
import {
  ArrowRight,
  BellRing,
  Bot,
  CalendarSync,
  ClipboardList,
  Clock,
  Mic2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, getCurrentUser } from "@/lib/auth";
import { DEMO_ACCOUNTS, demoEnabled, isDemoEmail } from "@/lib/demo";

/** Signs in as a seeded demo account. Only for the demo emails, only when demo mode is on. */
async function demoSignIn(formData: FormData) {
  "use server";
  if (!demoEnabled()) redirect("/login");
  const email = String(formData.get("email") ?? "");
  if (!isDemoEmail(email)) redirect("/login");
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user) redirect("/login");
  await createSession(user.id);
  redirect("/home");
}

const STAGE = "#16121f"; // the hero is always "lights down", in light and dark mode

export default async function Landing() {
  if (await getCurrentUser()) redirect("/home");
  const demo = demoEnabled();

  return (
    <div className="overflow-x-hidden">
      {/* ───────── Hero: the stage ───────── */}
      <section className="relative isolate text-[#f7f4ee]" style={{ background: STAGE }}>
        {/* spotlight + curtain folds */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(60% 55% at 70% 18%, rgba(240,180,84,.22), transparent 70%), radial-gradient(45% 60% at 10% 0%, rgba(124,58,237,.35), transparent 70%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-6 opacity-70"
          style={{ background: "repeating-linear-gradient(90deg, #4c1d95 0 18px, #5b21b6 18px 30px, #3b0f7a 30px 44px)" }}
        />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-6 -z-10 h-4 bg-gradient-to-b from-black/40 to-transparent" />

        <header className="mx-auto flex max-w-6xl items-center justify-between px-4 pt-10 sm:px-6">
          <span className="font-display text-2xl font-semibold tracking-tight">
            Call<span className="text-[#f0b454]">time</span>
          </span>
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center rounded-full border border-white/20 px-4 text-sm font-semibold hover:bg-white/10"
          >
            Sign in
          </Link>
        </header>

        <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-4 pb-20 pt-12 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:pb-28 lg:pt-16">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 rounded-full border border-[#f0b454]/30 bg-[#f0b454]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#f0b454]">
              <span className="size-1.5 rounded-full bg-[#f0b454]" /> For theater companies
            </p>
            <h1 className="mt-5 font-display text-[2.75rem] font-semibold leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
              Know exactly when you&apos;re <em className="font-medium italic text-[#f0b454]">called.</em>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-[#cfc8dc]">
              Schedule rehearsals by scene. Every actor — and every parent — instantly sees their own call time, release time and
              what to bring. No more reading every post in the group chat.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              {demo ? (
                <a
                  href="#demo"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#f0b454] px-6 font-semibold text-[#1b1726] shadow-[0_8px_30px_-8px_rgba(240,180,84,.6)] hover:brightness-105"
                >
                  Try the demo <ArrowRight className="size-4" />
                </a>
              ) : null}
              <Link
                href="/login"
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/20 px-6 font-semibold hover:bg-white/10"
              >
                Sign in
              </Link>
            </div>
            <p className="mt-4 text-sm text-[#a39cb3]">Built for youth theater: minors, guardians, carpools and all.</p>
          </div>

          <CallSheetTicket />
        </div>
      </section>

      {/* ───────── The problem ───────── */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">The problem</p>
            <h2 className="mt-3 font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
              A group chat is not a rehearsal schedule.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted">
              Directors post the week in paragraphs. Corrections land three scrolls later. Every family reads every post to work out
              whether <em>their</em> kid is needed — and someone still shows up an hour early, or not at all.
            </p>
            <p className="mt-4 text-lg leading-relaxed text-muted">
              Calltime turns “Act 1 Sc 3–5, pirates at 6:30, daughters 7:15 except Edith” into one line per person:
              <span className="font-semibold text-ink"> Maya · Tue 6:15–8:00 PM.</span>
            </p>
          </div>
          <ChatMess />
        </div>
      </section>

      {/* ───────── How it works ───────── */}
      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">How it works</p>
          <h2 className="mt-3 max-w-2xl font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Three acts. No intermission.
          </h2>
          <ol className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              {
                act: "Act I",
                title: "Set up scenes & roles",
                body: "Enter the scene breakdown once — who's in each scene, ensembles, groups like “Pirates” or “Daughters”, understudies.",
              },
              {
                act: "Act II",
                title: "Schedule by scene",
                body: "Build each rehearsal from time blocks: “6:15 Act 1 Sc 3 with the choreographer.” Calltime works out who's needed, and when.",
              },
              {
                act: "Act III",
                title: "Everyone gets their call",
                body: "Publish, and each actor and guardian sees just their calls — in the app and in a calendar feed that updates itself.",
              },
            ].map((s, i) => (
              <li key={s.act} className="relative rounded-2xl border border-line bg-bg p-6">
                <span className="font-display text-sm font-semibold italic text-gold">{s.act}</span>
                <h3 className="mt-2 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 leading-relaxed text-muted">{s.body}</p>
                <span aria-hidden className="absolute right-5 top-4 font-display text-6xl font-semibold text-line">
                  {i + 1}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ───────── Features ───────── */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">What&apos;s in the program</p>
        <h2 className="mt-3 max-w-2xl font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          Everything a stage manager wishes the chat could do.
        </h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { icon: Clock, title: "Call times per actor", body: "Earliest block you're in is your call; the last is your release. Understudies and swings handled." },
            { icon: Users, title: "Built for guardians", body: "Parents see every child's calls in one list — siblings in different scenes, different times, no mental math." },
            { icon: CalendarSync, title: "Calendar sync", body: "Subscribe once from Google, Apple or Outlook. Reschedules and cancellations update on their own." },
            { icon: BellRing, title: "Changes stand out", body: "Updated rehearsals are flagged, so a moved call time isn't buried in post #212." },
            { icon: Mic2, title: "Auditions", body: "Public signup with time slots, check-in, callbacks and casting — straight into the cast list." },
            { icon: Bot, title: "AI setup from a script", body: "Connect Claude or another assistant over MCP and turn a script into scenes, roles and a breakdown." },
          ].map((f) => (
            <div key={f.title} className="rounded-2xl border border-line bg-surface p-6">
              <span className="inline-flex size-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <f.icon className="size-5" />
              </span>
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-1.5 leading-relaxed text-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ───────── Demo ───────── */}
      {demo ? (
        <section id="demo" className="scroll-mt-6 border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">Try the demo</p>
                <h2 className="mt-3 font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
                  Take a seat in Riverside Youth Theatre.
                </h2>
                <p className="mt-3 max-w-2xl text-muted">
                  <em>The Pirates of Penzance</em> is in rehearsals and <em>A Midsummer Night&apos;s Dream</em> is holding auditions.
                  Pick a role — one tap signs you in.
                </p>
              </div>
              <p className="flex items-center gap-2 text-sm text-muted">
                <ClipboardList className="size-4" /> Password for every account: <code className="font-mono text-ink">calltime</code>
              </p>
            </div>
            <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {DEMO_ACCOUNTS.map((a) => (
                <form key={a.email} action={demoSignIn}>
                  <input type="hidden" name="email" value={a.email} />
                  <button
                    type="submit"
                    className="group flex h-full min-h-24 w-full items-start gap-3 rounded-2xl border border-line bg-bg p-4 text-left transition hover:border-gold hover:shadow-md active:scale-[.99]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold uppercase tracking-wider text-gold">{a.role}</span>
                      <span className="mt-0.5 block font-semibold">{a.name}</span>
                      <span className="mt-1 block text-sm leading-snug text-muted">{a.blurb}</span>
                    </span>
                    <ArrowRight className="mt-5 size-4 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-gold" />
                  </button>
                </form>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* ───────── Curtain call ───────── */}
      <section className="text-[#f7f4ee]" style={{ background: STAGE }}>
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-16 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-display text-3xl font-semibold tracking-tight">Places, everyone.</h2>
            <p className="mt-2 text-[#cfc8dc]">Calltime is set up by your company. Got an invite link? Open it to join.</p>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            {demo ? (
              <a href="#demo" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[#f0b454] px-6 font-semibold text-[#1b1726]">
                Try the demo
              </a>
            ) : null}
            <Link href="/login" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/20 px-6 font-semibold hover:bg-white/10">
              Sign in
            </Link>
          </div>
        </div>
        <footer className="mx-auto max-w-6xl border-t border-white/10 px-4 py-6 text-sm text-[#a39cb3] sm:px-6">
          Call<span className="text-[#f0b454]">time</span> · Rehearsal schedules and call times for theater companies, cast and families.
        </footer>
      </section>
    </div>
  );
}

/** The hero visual: a personal call sheet printed as a ticket stub. Pure CSS. */
function CallSheetTicket() {
  const blocks = [
    { time: "6:15", title: "Act 1 · Sc 3", note: "“Climbing over rocky mountain” — Daughters", called: true },
    { time: "7:00", title: "Act 1 · Sc 5", note: "Pirates only", called: false },
    { time: "7:30", title: "Act 2 · Sc 1", note: "“Poor wand'ring one” w/ Music Director", called: true },
  ];
  return (
    <div className="relative mx-auto w-full max-w-sm lg:max-w-md">
      <div aria-hidden className="absolute -inset-6 -z-10 rounded-[2rem] bg-[#f0b454]/10 blur-2xl" />
      <div className="rotate-[-2deg] overflow-hidden rounded-2xl bg-[#fbf7ef] text-[#1b1726] shadow-[0_30px_60px_-20px_rgba(0,0,0,.7)] transition duration-500 hover:rotate-0">
        {/* main */}
        <div className="relative px-6 pb-6 pt-5">
          <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.2em] text-[#6b6478]">
            <span>Call sheet</span>
            <span>Tue · Oct 7</span>
          </div>
          <p className="mt-3 font-display text-lg font-semibold italic leading-tight">The Pirates of Penzance</p>
          <div className="mt-4 flex items-end justify-between gap-4 border-b border-dashed border-[#d8d0c2] pb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[#6d28d9]">Maya Rivera</p>
              <p className="text-sm text-[#6b6478]">Edith · Daughters</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6b6478]">Called</p>
              <p className="font-display text-4xl font-semibold leading-none tabular-nums">6:15</p>
              <p className="mt-1 text-xs text-[#6b6478]">Released 8:00 PM</p>
            </div>
          </div>
          <ul className="mt-4 space-y-2.5">
            {blocks.map((b) => (
              <li key={b.time} className={b.called ? "flex gap-3" : "flex gap-3 opacity-35"}>
                <span className="w-10 shrink-0 font-mono text-xs leading-5 tabular-nums">{b.time}</span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    {b.called ? <span className="size-1.5 rounded-full bg-[#d9952b]" /> : null}
                    {b.title}
                  </span>
                  <span className="block truncate text-xs text-[#6b6478]">{b.note}</span>
                </span>
              </li>
            ))}
          </ul>
          {/* perforation notches */}
          <span aria-hidden className="absolute -bottom-3 -left-3 size-6 rounded-full" style={{ background: STAGE }} />
          <span aria-hidden className="absolute -bottom-3 -right-3 size-6 rounded-full" style={{ background: STAGE }} />
        </div>
        {/* stub */}
        <div className="flex items-center justify-between gap-4 border-t-2 border-dashed border-[#d8d0c2] bg-[#f3ecdf] px-6 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#6b6478]">Admit one</p>
            <p className="text-sm font-semibold">Rehearsal Hall, Room B</p>
          </div>
          <div
            aria-hidden
            className="h-9 w-24 opacity-80"
            style={{
              background:
                "repeating-linear-gradient(90deg, #1b1726 0 2px, transparent 2px 4px, #1b1726 4px 5px, transparent 5px 8px, #1b1726 8px 11px, transparent 11px 12px)",
            }}
          />
        </div>
      </div>
      <div className="absolute -right-2 -top-4 rotate-6 rounded-lg bg-[#6d28d9] px-3 py-1.5 text-xs font-semibold text-white shadow-lg sm:-right-6">
        Synced to your calendar ✓
      </div>
    </div>
  );
}

/** The before picture: a cluttered group-chat thread. */
function ChatMess() {
  const msgs = [
    { who: "Director", text: "Tues: Act 1 sc 3-5. Pirates 6:30, daughters 7:15 except Edith + Kate come at 6:15 for the dance 💃" },
    { who: "Parent", text: "Is Leo a pirate or police this week??" },
    { who: "Director", text: "CORRECTION — sc 5 moved to Thurs, so daughters can leave at 8 not 8:30" },
    { who: "Parent", text: "Wait so does Maya need to be there Tuesday?" },
    { who: "Stage Mgr", text: "Reminder: pls read the pinned post (the new one, not the old pinned one)" },
  ];
  return (
    <div className="relative">
      <div className="space-y-2.5 rounded-3xl border border-line bg-surface-2 p-4 pb-12 sm:p-5 sm:pb-12">
        {msgs.map((m, i) => (
          <div key={i} className={i % 2 ? "ml-8 flex justify-end" : "mr-8"}>
            <div className={i % 2 ? "rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2" : "rounded-2xl rounded-bl-md bg-surface px-3.5 py-2 shadow-sm"}>
              <p className="text-[11px] font-semibold text-muted">{m.who}</p>
              <p className="text-sm leading-snug">{m.text}</p>
            </div>
          </div>
        ))}
        <p className="pt-1 text-center text-xs text-muted">212 unread messages</p>
      </div>
      <div className="absolute -bottom-5 left-1/2 w-[85%] -translate-x-1/2 rounded-2xl border border-gold/50 bg-surface px-4 py-3 shadow-xl sm:w-auto sm:min-w-80">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold">Calltime</p>
        <p className="mt-0.5 text-sm">
          <span className="font-semibold">Maya</span> · Tue 6:15–8:00 PM · <span className="font-semibold">Leo</span> · not called
        </p>
      </div>
    </div>
  );
}
