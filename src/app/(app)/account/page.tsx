import { eq, inArray } from "drizzle-orm";
import { CalendarPlus, ChevronRight, HandHeart, LogOut, Shield } from "lucide-react";
import Link from "next/link";
import { db } from "@/db";
import { guardianships, organizations, people } from "@/db/schema";
import { Avatar, Badge, Button, Card, Field, Input, List, PageHeader, SectionTitle } from "@/components/ui";
import { getUserOrgs, getUserProductions } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { vapidPublicKey } from "@/lib/push";
import { countOpenShifts, fmtWhen, getMySignups, isUpcoming } from "@/lib/volunteers";
import { ActionForm } from "../org/_components/action-form";
import { currentRoles } from "../org/_lib/org";
import { PushToggle } from "./_components/push-toggle";
import { changePassword, inviteCoGuardian, updateProfile } from "./actions";

export const metadata = { title: "Me" };

export default async function AccountPage() {
  const user = await requireUser();
  const [own, orgs] = await Promise.all([
    db
      .select({ person: people, org: organizations })
      .from(people)
      .innerJoin(organizations, eq(organizations.id, people.orgId))
      .where(eq(people.userId, user.id)),
    getUserOrgs(user),
  ]);
  const ownIds = own.map((o) => o.person.id);
  const wards = ownIds.length
    ? await db
        .select({ person: people, relationship: guardianships.relationship, org: organizations })
        .from(guardianships)
        .innerJoin(people, eq(people.id, guardianships.minorId))
        .innerJoin(organizations, eq(organizations.id, people.orgId))
        .where(inArray(guardianships.guardianId, ownIds))
    : [];
  const [shows, mySignups] = await Promise.all([getUserProductions(user), getMySignups(user.id)]);
  const activeShows = shows.filter((s) => s.production.status !== "closed");
  const openCounts = await countOpenShifts(activeShows.map((s) => s.production.id));
  const myUpcoming = mySignups.filter((m) => isUpcoming(m.shift));
  const tzOf = new Map([...own, ...wards].map((r) => [r.org.id, r.org.timezone]));
  const multiOrg = new Set([...own, ...wards].map((r) => r.org.id)).size > 1;

  const seen = new Set<string>();
  const kids = wards.filter((w) => !seen.has(w.person.id) && seen.add(w.person.id));
  // Own person records only matter here when they're cast in something (teens, adult performers).
  const roleRows = await Promise.all([...kids.map((k) => k.person.id), ...ownIds].map(async (id) => [id, await currentRoles(id)] as const));
  const rolesOf = new Map(roleRows);
  const ownCast = own.filter((o) => (rolesOf.get(o.person.id) ?? []).length > 0);

  const describe = (id: string) => {
    const r = rolesOf.get(id) ?? [];
    if (r.length === 0) return "Not in a current show";
    const byShow = new Map<string, string[]>();
    for (const x of r) byShow.set(x.production, [...(byShow.get(x.production) ?? []), x.kind === "primary" ? x.role : `${x.role} (${x.kind})`]);
    return [...byShow].map(([show, rs]) => `${rs.join(", ")} · ${show}`).join(" — ");
  };

  return (
    <div>
      <PageHeader title="Me" subtitle={`${user.name} · ${user.email}`} />

      {kids.length ? (
        <>
          <SectionTitle>My kids</SectionTitle>
          <List>
            {kids.map((k) => {
              const name = `${k.person.firstName} ${k.person.lastName}`.trim();
              return (
                <div key={k.person.id}>
                  <Link href="/home" className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-surface-2">
                    <Avatar name={name} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{name}</div>
                      <div className="text-sm text-muted">
                        {describe(k.person.id)}
                        {multiOrg ? ` · ${k.org.name}` : ""}
                      </div>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted" />
                  </Link>
                  <details className="px-4 pb-3">
                    <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-sm font-medium text-accent">
                      + Invite another parent or guardian
                    </summary>
                    <div className="pt-2">
                      <p className="mb-3 text-sm text-muted">
                        They&apos;ll get their own sign-in and see {k.person.firstName}&apos;s calls too.
                      </p>
                      <ActionForm action={inviteCoGuardian} submitLabel="Get invite link" pendingLabel="Creating…" resetOnSuccess>
                        <input type="hidden" name="minorId" value={k.person.id} />
                        <Field label="Their name (optional)">
                          <Input name="name" autoComplete="off" />
                        </Field>
                        <Field label="Their email">
                          <Input name="email" type="email" required autoComplete="off" />
                        </Field>
                      </ActionForm>
                    </div>
                  </details>
                </div>
              );
            })}
          </List>
        </>
      ) : null}

      {ownCast.length ? (
        <>
          <SectionTitle>My roles</SectionTitle>
          <List>
            {ownCast.map((o) => (
              <Link key={o.person.id} href="/home" className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-surface-2">
                <Avatar name={user.name} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">You</div>
                  <div className="text-sm text-muted">{describe(o.person.id)}</div>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted" />
              </Link>
            ))}
          </List>
        </>
      ) : null}

      {kids.length === 0 && ownCast.length === 0 ? (
        <p className="mt-2 rounded-2xl border border-dashed border-line px-4 py-4 text-base text-muted">
          You&apos;re not linked to a performer yet. If your child is in a show, ask the company office to send you a guardian invite.
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted">Calls for everyone here show up on Calls. Ask the company office if someone is missing.</p>
      )}

      {myUpcoming.length || openCounts.size ? (
        <>
          <SectionTitle>Volunteering</SectionTitle>
          <List>
            {myUpcoming.slice(0, 3).map((m) => (
              <Link
                key={m.shift.id}
                href={`/p/${m.production.id}/volunteers`}
                className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-surface-2"
              >
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-success-soft text-success">
                  <HandHeart className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{m.shift.title}</div>
                  <div className="text-sm text-muted">
                    {fmtWhen(m.shift, tzOf.get(m.production.orgId) ?? "America/New_York")} · {m.production.title}
                  </div>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted" />
              </Link>
            ))}
            {activeShows
              .filter((s) => openCounts.get(s.production.id))
              .map((s) => (
                <Link
                  key={s.production.id}
                  href={`/p/${s.production.id}/volunteers`}
                  className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-surface-2"
                >
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-gold-soft text-gold">
                    <HandHeart className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {openCounts.get(s.production.id)} volunteer shift{openCounts.get(s.production.id) === 1 ? "" : "s"} need help
                    </div>
                    <div className="text-sm text-muted">{s.production.title}</div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted" />
                </Link>
              ))}
          </List>
        </>
      ) : null}

      <SectionTitle>Calendar</SectionTitle>
      <Link href="/home/calendar" className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 hover:bg-surface-2">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-gold-soft text-gold">
          <CalendarPlus className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">Add calls to my calendar</span>
          <span className="block text-sm text-muted">Subscribe once in Google, Apple or Outlook — changes sync on their own.</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted" />
      </Link>

      <SectionTitle>Notifications</SectionTitle>
      <Card>
        <PushToggle publicKey={vapidPublicKey()} />
      </Card>

      <SectionTitle>Account</SectionTitle>
      <Card>
        <ActionForm action={updateProfile} submitLabel="Save profile">
          <Field label="Name">
            <Input name="name" required defaultValue={user.name} autoComplete="name" />
          </Field>
          <Field label="Email" hint="You sign in with this. Ask a company admin if it needs to change.">
            <Input value={user.email} disabled readOnly />
          </Field>
          <Field label="Phone (optional)">
            <Input name="phone" type="tel" defaultValue={user.phone ?? ""} autoComplete="tel" />
          </Field>
        </ActionForm>
      </Card>
      {orgs.length && !user.isPlatformAdmin ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {orgs.map((m) => (
            <Badge key={m.org.id} tone={m.role === "admin" ? "accent" : "neutral"}>
              {m.org.name}
              {m.role === "admin" ? " · Admin" : ""}
            </Badge>
          ))}
        </div>
      ) : null}

      <details className="mt-3 rounded-2xl border border-line bg-surface">
        <summary className="flex min-h-12 cursor-pointer list-none items-center px-4 font-medium">Change password</summary>
        <div className="border-t border-line p-4">
          <ActionForm action={changePassword} submitLabel="Change password" resetOnSuccess>
            <input type="email" name="username" value={user.email} autoComplete="username" readOnly hidden />
            <Field label="Current password">
              <Input name="current" type="password" required autoComplete="current-password" />
            </Field>
            <Field label="New password" hint="At least 8 characters.">
              <Input name="next" type="password" required minLength={8} autoComplete="new-password" />
            </Field>
            <Field label="Type the new password again">
              <Input name="confirm" type="password" required minLength={8} autoComplete="new-password" />
            </Field>
          </ActionForm>
        </div>
      </details>

      {user.isPlatformAdmin ? (
        <Link href="/admin" className="mt-3 flex min-h-12 items-center gap-3 rounded-2xl border border-line bg-surface px-4 hover:bg-surface-2">
          <Shield className="size-5 text-gold" />
          <span className="flex-1 font-medium">Platform admin</span>
          <ChevronRight className="size-4 text-muted" />
        </Link>
      ) : null}

      <form action="/logout" method="post" className="mt-8">
        <Button type="submit" variant="secondary" className="w-full">
          <LogOut className="size-4" /> Sign out
        </Button>
      </form>
    </div>
  );
}
