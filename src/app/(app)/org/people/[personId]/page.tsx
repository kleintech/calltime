import { and, eq, inArray, ne } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/db";
import { guardianships, people, productions, roleAssignments, roles, users } from "@/db/schema";
import { requireOrgAdmin } from "@/lib/access";
import {
  Avatar,
  Badge,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Input,
  List,
  PageHeader,
  SectionTitle,
  Select,
  Textarea,
} from "@/components/ui";
import { ActionForm, SubmitButton } from "../../_components/action-form";
import { Disclosure } from "../../_components/disclosure";
import { OrgChrome } from "../../_components/org-chrome";
import { PendingInvites } from "../../_components/pending-invites";
import { getAdminOrgs, getPendingInvites, orgHref, personName, UUID_RE } from "../../_lib/org";
import {
  addGuardian,
  deletePerson,
  invitePerson,
  inviteGuardian,
  linkPerson,
  removeGuardianship,
  unlinkAccount,
  updatePerson,
} from "../actions";

export const metadata = { title: "Person" };

const KIND_LABEL = { primary: null, understudy: "Understudy", swing: "Swing" } as const;

export default async function PersonPage({ params }: PageProps<"/org/people/[personId]">) {
  const { personId } = await params;
  if (!UUID_RE.test(personId)) notFound();
  const person = await db.query.people.findFirst({ where: eq(people.id, personId) });
  if (!person) notFound();
  const { user, org } = await requireOrgAdmin(person.orgId);
  const orgs = await getAdminOrgs(user);

  const [account, guardianLinks, wardLinks, casting, others, pending] = await Promise.all([
    person.userId ? db.query.users.findFirst({ where: eq(users.id, person.userId) }) : undefined,
    db
      .select({ person: people, relationship: guardianships.relationship })
      .from(guardianships)
      .innerJoin(people, eq(people.id, guardianships.guardianId))
      .where(eq(guardianships.minorId, person.id)),
    db
      .select({ person: people, relationship: guardianships.relationship })
      .from(guardianships)
      .innerJoin(people, eq(people.id, guardianships.minorId))
      .where(eq(guardianships.guardianId, person.id)),
    db
      .select({ production: productions, role: roles.name, kind: roleAssignments.kind })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .innerJoin(productions, eq(productions.id, roles.productionId))
      .where(and(eq(roleAssignments.personId, person.id), eq(productions.orgId, org.id)))
      .orderBy(productions.createdAt),
    db
      .select()
      .from(people)
      .where(and(eq(people.orgId, org.id), ne(people.id, person.id)))
      .orderBy(people.lastName, people.firstName),
    getPendingInvites(org.id, person.id),
  ]);

  // Which guardians have accounts (for the "Invite" affordance).
  const guardianUserIds = guardianLinks.map((g) => g.person.userId).filter((x): x is string => !!x);
  const guardianAccounts = guardianUserIds.length
    ? new Set((await db.select({ id: users.id }).from(users).where(inArray(users.id, guardianUserIds))).map((u) => u.id))
    : new Set<string>();

  const byProduction = new Map<string, { production: typeof productions.$inferSelect; roles: string[] }>();
  for (const c of casting) {
    const entry = byProduction.get(c.production.id) ?? { production: c.production, roles: [] };
    entry.roles.push(KIND_LABEL[c.kind] ? `${c.role} (${KIND_LABEL[c.kind]})` : c.role);
    byProduction.set(c.production.id, entry);
  }

  const name = personName(person);
  const linkedIds = new Set([...guardianLinks, ...wardLinks].map((l) => l.person.id));
  const linkable = others.filter((o) => !linkedIds.has(o.id));
  const showGuardians = person.isMinor || guardianLinks.length > 0;
  const showWards = !person.isMinor || wardLinks.length > 0;
  const nobodyCovers = person.isMinor && !person.userId && !guardianLinks.some((g) => g.person.userId);

  return (
    <div>
      <PageHeader
        back={{ href: orgHref("/org/people", org.id), label: "People" }}
        title={
          <span className="flex items-center gap-3">
            <Avatar name={name} className="size-11 text-sm" />
            <span className="min-w-0 truncate">{name}</span>
          </span>
        }
        subtitle={
          <span className="flex flex-wrap gap-1.5 pt-1">
            {person.isMinor ? <Badge>Minor{person.birthYear ? ` · b. ${person.birthYear}` : ""}</Badge> : null}
            {account ? <Badge tone="success">Has account</Badge> : <Badge>No account</Badge>}
            {wardLinks.length ? <Badge tone="gold">Guardian</Badge> : null}
          </span>
        }
      />
      <OrgChrome org={org} orgs={orgs} active="people" path="/org/people" />

      {nobodyCovers ? (
        <div className="mb-4 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
          Nobody with an account covers {person.firstName} yet, so no one will see their calls. Invite a guardian below.
        </div>
      ) : null}

      {/* Productions */}
      <SectionTitle>Roles</SectionTitle>
      {byProduction.size === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-4 py-4 text-sm text-muted">Not cast in any production yet.</p>
      ) : (
        <List>
          {[...byProduction.values()].map(({ production, roles }) => (
            <Link key={production.id} href={`/p/${production.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: production.accentColor }} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{production.title}</div>
                <div className="truncate text-sm text-muted">{roles.join(", ")}</div>
              </div>
              {production.status === "closed" ? <Badge>Closed</Badge> : null}
            </Link>
          ))}
        </List>
      )}

      {/* Guardians */}
      {showGuardians ? (
        <>
          <SectionTitle>Guardians</SectionTitle>
          {guardianLinks.length ? (
            <List>
              {guardianLinks.map(({ person: g, relationship }) => {
                const hasAccount = !!g.userId && guardianAccounts.has(g.userId);
                return (
                  <div key={g.id} className="space-y-2 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={personName(g)} />
                      <Link href={`/org/people/${g.id}`} className="min-w-0 flex-1">
                        <div className="truncate font-medium">{personName(g)}</div>
                        <div className="truncate text-sm text-muted">
                          {[relationship, g.email, g.phone].filter(Boolean).join(" · ")}
                        </div>
                      </Link>
                      {hasAccount ? <Badge tone="success">Account</Badge> : <Badge tone="warn">No account</Badge>}
                    </div>
                    <div className="flex flex-wrap gap-2 pl-12">
                      {!hasAccount ? (
                        <details className="w-full">
                          <summary className="inline-flex min-h-10 cursor-pointer list-none items-center rounded-xl border border-line px-3 text-sm font-semibold">
                            Invite {g.firstName}
                          </summary>
                          <div className="mt-2">
                            <ActionForm action={invitePerson} submitLabel="Get invite link" resetOnSuccess pendingLabel="Creating…">
                              <input type="hidden" name="personId" value={g.id} />
                              <Field label={`${g.firstName}'s email`}>
                                <Input name="email" type="email" required defaultValue={g.email ?? ""} />
                              </Field>
                            </ActionForm>
                          </div>
                        </details>
                      ) : null}
                      <form action={removeGuardianship}>
                        <input type="hidden" name="guardianId" value={g.id} />
                        <input type="hidden" name="minorId" value={person.id} />
                        <SubmitButton variant="danger" confirm={`Remove ${personName(g)} as ${person.firstName}'s guardian?`}>
                          Remove
                        </SubmitButton>
                      </form>
                    </div>
                  </div>
                );
              })}
            </List>
          ) : (
            <EmptyState title="No guardians yet" body={`Add a parent or guardian so they see ${person.firstName}'s calls.`} />
          )}

          <div className="mt-3 grid gap-3">
            <Disclosure className="rounded-2xl border border-line bg-surface" defaultOpen={guardianLinks.length === 0}>
              <summary className="flex min-h-12 cursor-pointer list-none items-center px-4 font-medium">+ Add a guardian</summary>
              <div className="border-t border-line p-4">
                <ActionForm action={addGuardian} submitLabel="Add guardian" resetOnSuccess pendingLabel="Adding…">
                  <input type="hidden" name="personId" value={person.id} />
                  <Field label="Name">
                    <Input name="name" required autoComplete="off" placeholder="Dana Rivera" />
                  </Field>
                  <Field label="Email (optional)" hint="Needed to send them an invite. If someone in the company already has this email, they're linked instead of duplicated.">
                    <Input name="email" type="email" autoComplete="off" />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Phone (optional)">
                      <Input name="phone" type="tel" autoComplete="off" />
                    </Field>
                    <Field label="Relationship (optional)">
                      <Input name="relationship" placeholder="Parent" list="relationships" />
                    </Field>
                  </div>
                </ActionForm>
              </div>
            </Disclosure>
            {linkable.length ? (
              <details className="rounded-2xl border border-line bg-surface">
                <summary className="flex min-h-12 cursor-pointer list-none items-center px-4 font-medium">
                  Link someone already in the company
                </summary>
                <div className="border-t border-line p-4">
                  <ActionForm action={linkPerson} submitLabel="Link as guardian" resetOnSuccess>
                    <input type="hidden" name="personId" value={person.id} />
                    <input type="hidden" name="as" value="guardian" />
                    <Field label="Guardian">
                      <Select name="otherId" required defaultValue="">
                        <option value="" disabled>
                          Choose a person…
                        </option>
                        {linkable
                          .filter((o) => !o.isMinor)
                          .concat(linkable.filter((o) => o.isMinor))
                          .map((o) => (
                            <option key={o.id} value={o.id}>
                              {personName(o)}
                              {o.isMinor ? " (minor)" : ""}
                            </option>
                          ))}
                      </Select>
                    </Field>
                    <Field label="Relationship (optional)">
                      <Input name="relationship" placeholder="Parent" list="relationships" />
                    </Field>
                  </ActionForm>
                </div>
              </details>
            ) : null}
            <details className="rounded-2xl border border-line bg-surface">
              <summary className="flex min-h-12 cursor-pointer list-none items-center px-4 font-medium">
                Send a guardian invite link
              </summary>
              <div className="border-t border-line p-4">
                <p className="mb-3 text-sm text-muted">
                  They create an account from the link and are linked as {person.firstName}&apos;s guardian automatically.
                </p>
                <ActionForm action={inviteGuardian} submitLabel="Get invite link" resetOnSuccess pendingLabel="Creating…">
                  <input type="hidden" name="personId" value={person.id} />
                  <Field label="Guardian's name (optional)">
                    <Input name="name" autoComplete="off" />
                  </Field>
                  <Field label="Guardian's email">
                    <Input name="email" type="email" required autoComplete="off" />
                  </Field>
                </ActionForm>
              </div>
            </details>
          </div>
        </>
      ) : null}

      {/* Wards */}
      {showWards ? (
        <>
          <SectionTitle>Responsible for</SectionTitle>
          {wardLinks.length ? (
            <List>
              {wardLinks.map(({ person: w, relationship }) => (
                <div key={w.id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar name={personName(w)} />
                  <Link href={`/org/people/${w.id}`} className="min-w-0 flex-1">
                    <div className="truncate font-medium">{personName(w)}</div>
                    <div className="truncate text-sm text-muted">{relationship}</div>
                  </Link>
                  <form action={removeGuardianship}>
                    <input type="hidden" name="guardianId" value={person.id} />
                    <input type="hidden" name="minorId" value={w.id} />
                    <SubmitButton variant="danger" confirm={`Stop ${person.firstName} covering ${w.firstName}?`}>
                      Remove
                    </SubmitButton>
                  </form>
                </div>
              ))}
            </List>
          ) : (
            <p className="rounded-2xl border border-dashed border-line px-4 py-4 text-sm text-muted">
              Not a guardian of anyone. Link a child below if {person.firstName} is a parent.
            </p>
          )}
          {linkable.some((o) => o.isMinor) ? (
            <details className="mt-3 rounded-2xl border border-line bg-surface">
              <summary className="flex min-h-12 cursor-pointer list-none items-center px-4 font-medium">+ Link a child</summary>
              <div className="border-t border-line p-4">
                <ActionForm action={linkPerson} submitLabel="Link child" resetOnSuccess>
                  <input type="hidden" name="personId" value={person.id} />
                  <input type="hidden" name="as" value="ward" />
                  <Field label="Child">
                    <Select name="otherId" required defaultValue="">
                      <option value="" disabled>
                        Choose a minor…
                      </option>
                      {linkable
                        .filter((o) => o.isMinor)
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {personName(o)}
                          </option>
                        ))}
                    </Select>
                  </Field>
                  <Field label="Relationship (optional)">
                    <Input name="relationship" placeholder="Parent" list="relationships" />
                  </Field>
                </ActionForm>
              </div>
            </details>
          ) : null}
        </>
      ) : null}
      <datalist id="relationships">
        {["Mother", "Father", "Parent", "Guardian", "Grandparent", "Stepparent", "Aunt", "Uncle"].map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>

      {/* Account */}
      <SectionTitle>Account</SectionTitle>
      <Card>
        {account ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium">{account.name}</div>
              <div className="truncate text-sm text-muted">{account.email}</div>
              <div className="mt-1 text-xs text-muted">
                {person.firstName} signs in and sees their own calls{wardLinks.length ? " and their kids' calls" : ""}.
              </div>
            </div>
            <form action={unlinkAccount}>
              <input type="hidden" name="personId" value={person.id} />
              <SubmitButton variant="danger" confirm={`Unlink ${account.email} from ${name}? They'll stop seeing these calls.`}>
                Unlink
              </SubmitButton>
            </form>
          </div>
        ) : (
          <div>
            <p className="mb-3 text-sm text-muted">
              {person.isMinor
                ? `Most kids don't need an account — their guardians see their calls. Older kids can have their own.`
                : `Send ${person.firstName} a link to create an account and see their calls.`}
            </p>
            <ActionForm action={invitePerson} submitLabel="Get invite link" resetOnSuccess pendingLabel="Creating…">
              <input type="hidden" name="personId" value={person.id} />
              <Field label="Email they'll sign in with">
                <Input name="email" type="email" required defaultValue={person.email ?? ""} autoComplete="off" />
              </Field>
            </ActionForm>
          </div>
        )}
      </Card>

      {pending.length ? (
        <>
          <SectionTitle>Pending invites</SectionTitle>
          <PendingInvites orgId={org.id} timezone={org.timezone} items={pending} />
        </>
      ) : null}

      {/* Details */}
      <SectionTitle>Details</SectionTitle>
      <Card>
        <ActionForm action={updatePerson} submitLabel="Save details">
          <input type="hidden" name="personId" value={person.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name">
              <Input name="firstName" required defaultValue={person.firstName} />
            </Field>
            <Field label="Last name (optional)">
              <Input name="lastName" defaultValue={person.lastName} />
            </Field>
            <Field label="Email (optional)">
              <Input name="email" type="email" defaultValue={person.email ?? ""} />
            </Field>
            <Field label="Phone (optional)">
              <Input name="phone" type="tel" defaultValue={person.phone ?? ""} />
            </Field>
            <Field label="Birth year (optional)">
              <Input name="birthYear" inputMode="numeric" pattern="[0-9]{4}" defaultValue={person.birthYear ?? ""} />
            </Field>
            <div className="flex items-end">
              <Checkbox name="isMinor" defaultChecked={person.isMinor} label="Under 18 (needs a guardian)" />
            </div>
          </div>
          <Field label="Notes (optional)" hint="Internal — not shown to families.">
            <Textarea name="notes" defaultValue={person.notes ?? ""} />
          </Field>
        </ActionForm>
      </Card>

      <div className="mt-8 border-t border-line pt-4">
        <form action={deletePerson}>
          <input type="hidden" name="personId" value={person.id} />
          <SubmitButton
            variant="danger"
            confirm={`Delete ${name}? This removes them from every cast list and schedule in ${org.name}. This can't be undone.`}
          >
            Delete person
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
