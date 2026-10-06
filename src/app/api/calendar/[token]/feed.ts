import "server-only";
import { and, asc, eq, gte, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { creativeTeam, events, orgMembers, organizations, people, productions, roleAssignments, users } from "@/db/schema";
import { getCoveredPersonIds } from "@/lib/access";
import { buildCallSheets, getCallsForPeople, loadCastIndex, type BlockWithCalls } from "@/lib/calls";
import { buildCalendar, type IcsEvent } from "@/lib/ics";
import { fmtRange } from "@/lib/time";

const LOOKBACK_MS = 60 * 86400_000;

type User = typeof users.$inferSelect;

function blockLine(b: BlockWithCalls, tz: string) {
  const what = b.title ? `${b.title}${b.labels.length ? ` (${b.labels.join(", ")})` : ""}` : b.labels.join(", ") || "Rehearsal";
  const extra = [b.leader ? `with ${b.leader}` : null, b.location ? `in ${b.location}` : null].filter(Boolean).join(", ");
  return `• ${fmtRange(b.startsAt, b.endsAt, tz)}  ${what}${extra ? ` — ${extra}` : ""}`;
}

/** "Pirates of Penzance rehearsal" when the title is just the kind, else "Pirates of Penzance: Act 2 run". */
function eventName(productionTitle: string, event: { title: string; kind: string }) {
  const t = event.title.trim();
  return t.toLowerCase() === event.kind ? `${productionTitle} ${t.toLowerCase()}` : `${productionTitle}: ${t}`;
}

async function orgTimezones(orgIds: string[]) {
  if (orgIds.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ id: organizations.id, tz: organizations.timezone })
    .from(organizations)
    .where(inArray(organizations.id, [...new Set(orgIds)]));
  return new Map(rows.map((r) => [r.id, r.tz]));
}

/** Builds the full .ics body for a user's personal subscription feed. */
export async function buildUserFeed(user: User, baseUrl: string): Promise<string> {
  const from = new Date(Date.now() - LOOKBACK_MS);
  const covered = await getCoveredPersonIds(user.id);
  const calls = await getCallsForPeople(covered, { from });

  // Prefix the person's name when the user covers more than one cast member (e.g. a guardian of
  // two kids), even if only one of them has calls in the window — titles stay stable.
  const castCovered = covered.length
    ? await db
        .selectDistinct({ id: roleAssignments.personId })
        .from(roleAssignments)
        .where(inArray(roleAssignments.personId, covered))
    : [];
  const multiPerson = castCovered.length > 1 || new Set(calls.map((c) => c.person.id)).size > 1;
  // The user's own person records (not their wards'): if they're personally called to an event,
  // their personal entry replaces the leadership one; a ward's call doesn't.
  const ownPersonIds = new Set(
    (await db.select({ id: people.id }).from(people).where(eq(people.userId, user.id))).map((r) => r.id),
  );

  /* Productions this user leads: creative team seats + productions of orgs they administer. */
  const ctRows = await db
    .select({ productionId: creativeTeam.productionId })
    .from(creativeTeam)
    .where(eq(creativeTeam.userId, user.id));
  const adminOrgRows = await db
    .select({ orgId: orgMembers.orgId })
    .from(orgMembers)
    .where(and(eq(orgMembers.userId, user.id), eq(orgMembers.role, "admin")));
  const ledIds = new Set(ctRows.map((r) => r.productionId));
  if (adminOrgRows.length) {
    const rows = await db
      .select({ id: productions.id })
      .from(productions)
      .where(inArray(productions.orgId, adminOrgRows.map((r) => r.orgId)));
    for (const r of rows) ledIds.add(r.id);
  }
  const ledProductions = ledIds.size
    ? await db
        .select()
        .from(productions)
        .where(and(inArray(productions.id, [...ledIds]), ne(productions.status, "closed")))
    : [];

  const tzByOrg = await orgTimezones([...calls.map((c) => c.production.orgId), ...ledProductions.map((p) => p.orgId)]);
  const tzOf = (orgId: string) => tzByOrg.get(orgId) ?? "America/New_York";

  const out: IcsEvent[] = [];
  const eventsWithPersonalCalls = new Set<string>();

  for (const c of calls) {
    const tz = tzOf(c.production.orgId);
    const cancelled = c.event.status === "cancelled";
    if (ownPersonIds.has(c.person.id)) eventsWithPersonalCalls.add(c.event.id);
    const prefix = multiPerson ? `${c.person.firstName}: ` : "";
    // Many calendar apps hide STATUS:CANCELLED, so say it in the title too.
    const summary = `${cancelled ? "CANCELLED: " : ""}${prefix}${eventName(c.production.title, c.event)} (called ${fmtRange(c.callAt, c.releaseAt, tz)})`;
    const desc: string[] = [];
    if (cancelled) desc.push("This call has been cancelled.", "");
    desc.push(`${c.person.firstName} is called ${fmtRange(c.callAt, c.releaseAt, tz)}.`);
    if (c.reasons.length) desc.push(`Rehearsing: ${c.reasons.join("; ")}`);
    if (c.blocks.length) {
      desc.push("", "Schedule:");
      for (const b of c.blocks) desc.push(blockLine(b, tz));
    }
    if (c.event.notes) desc.push("", c.event.notes);
    desc.push("", `${baseUrl}/home`);
    out.push({
      uid: `${c.event.id}-${c.person.id}@calltime`,
      start: c.callAt,
      end: c.releaseAt,
      summary,
      description: desc.join("\n"),
      location: c.event.location,
      status: cancelled ? "CANCELLED" : "CONFIRMED",
      sequence: c.event.revision,
      lastModified: c.event.updatedAt,
    });
  }

  /* Leadership view: the whole event (not a personal call) for productions they lead. */
  for (const production of ledProductions) {
    const eventRows = await db
      .select()
      .from(events)
      .where(and(eq(events.productionId, production.id), ne(events.status, "draft"), gte(events.endsAt, from)))
      .orderBy(asc(events.startsAt));
    const toShow = eventRows.filter((e) => !eventsWithPersonalCalls.has(e.id));
    if (toShow.length === 0) continue;
    const tz = tzOf(production.orgId);
    const idx = await loadCastIndex(production.id);
    const sheets = await buildCallSheets(idx, toShow);
    for (const { event, blocks, calls: sheetCalls } of sheets) {
      const cancelled = event.status === "cancelled";
      const desc: string[] = [];
      if (cancelled) desc.push("This event has been cancelled.", "");
      desc.push(`${sheetCalls.size} ${sheetCalls.size === 1 ? "person" : "people"} called.`);
      if (blocks.length) {
        desc.push("", "Schedule:");
        for (const b of blocks) desc.push(blockLine(b, tz));
      }
      if (event.notes) desc.push("", event.notes);
      desc.push("", `${baseUrl}/p/${production.id}`);
      out.push({
        uid: `${event.id}-team@calltime`,
        start: event.startsAt,
        end: event.endsAt,
        summary: `${cancelled ? "CANCELLED: " : ""}${eventName(production.title, event)}`,
        description: desc.join("\n"),
        location: event.location,
        status: cancelled ? "CANCELLED" : "CONFIRMED",
        sequence: event.revision,
        lastModified: event.updatedAt,
      });
    }
  }

  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  return buildCalendar({
    name: `Calltime — ${user.name}`,
    description: "Rehearsal and performance calls from Calltime",
    refresh: "PT1H",
    events: out,
  });
}
