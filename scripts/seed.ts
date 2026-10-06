/**
 * Demo data: Riverside Youth Theatre with "The Pirates of Penzance" in rehearsals and
 * "A Midsummer Night's Dream" in auditions. WIPES ALL DATA. Every demo account's password is "calltime".
 *
 * Pirates also gets: rehearsal-material links (resources), volunteer shifts + a 6-hour family ask
 * (Dana signed up for Opening Night concessions), a published Wednesday moved 30 minutes earlier
 * with an event_changes row (Dana has not acknowledged it), a cancelled extra rehearsal with its own
 * change row, attendance for past rehearsals, four actor notes for Maya/Sam/Leo (Leo's unread) and
 * last week's published rehearsal report.
 * Midsummer signups include structured conflict dates. "Alice in Wonderland" is a closed show from
 * last spring (Maya as Alice, Ava as the Cheshire Cat) so families have a "Past shows" history.
 *
 *   npm run db:seed
 */
import { createHash, randomBytes } from "node:crypto";
import { TZDate } from "@date-fns/tz";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import * as s from "../src/db/schema";
import { fmtRange, fmtTime } from "../src/lib/time";

const TZ = "America/New_York";
const tok = (n = 24) => randomBytes(n).toString("base64url");
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

/** Wall-clock time in TZ, `days` from today. */
function at(days: number, hh: number, mm = 0) {
  const now = new TZDate(Date.now(), TZ);
  return new Date(new TZDate(now.getFullYear(), now.getMonth(), now.getDate() + days, hh, mm, 0, TZ).getTime());
}
function dateStr(days: number) {
  const d = new TZDate(Date.now(), TZ);
  const x = new TZDate(d.getFullYear(), d.getMonth(), d.getDate() + days, 12, 0, 0, TZ);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

async function main() {
  console.log("Wiping…");
  // CASCADE follows every foreign key, so all tables hanging off users / organizations (productions,
  // people, events, resources, volunteers, change log, attendance, notes, reports, push…) are wiped too.
  await db.execute(sql`TRUNCATE users, organizations, sessions RESTART IDENTITY CASCADE`);

  const passwordHash = await bcrypt.hash("calltime", 10);
  const mkUser = async (email: string, name: string, extra: Partial<typeof s.users.$inferInsert> = {}) => {
    const [u] = await db
      .insert(s.users)
      .values({ email, name, passwordHash, calendarToken: tok(), ...extra })
      .returning();
    return u;
  };

  /* Users */
  const admin = await mkUser("admin@calltime.dev", "Platform Admin", { isPlatformAdmin: true });
  const orgAdmin = await mkUser("office@riverside.dev", "Pat Okafor");
  const director = await mkUser("director@riverside.dev", "Jordan Ellis");
  const choreo = await mkUser("choreo@riverside.dev", "Alex Moreau");
  const musicDir = await mkUser("music@riverside.dev", "Priya Natarajan");
  const sm = await mkUser("sm@riverside.dev", "Casey Lin");
  const parentDana = await mkUser("dana@family.dev", "Dana Rivera");
  const parentMarcus = await mkUser("marcus@family.dev", "Marcus Webb");
  const teenSam = await mkUser("sam@family.dev", "Sam Chen");

  /* Org */
  const [org] = await db
    .insert(s.organizations)
    .values({ name: "Riverside Youth Theatre", slug: "riverside", timezone: TZ })
    .returning();
  await db.insert(s.orgMembers).values([
    { orgId: org.id, userId: orgAdmin.id, role: "admin" },
    { orgId: org.id, userId: director.id, role: "member" },
    { orgId: org.id, userId: choreo.id, role: "member" },
    { orgId: org.id, userId: musicDir.id, role: "member" },
    { orgId: org.id, userId: sm.id, role: "member" },
    { orgId: org.id, userId: parentDana.id, role: "member" },
    { orgId: org.id, userId: parentMarcus.id, role: "member" },
    { orgId: org.id, userId: teenSam.id, role: "member" },
  ]);

  /* Production */
  const [pirates] = await db
    .insert(s.productions)
    .values({
      orgId: org.id,
      title: "The Pirates of Penzance",
      subtitle: "Fall Musical",
      description: "Gilbert & Sullivan's comic opera of pirates, police and a very model Major-General.",
      venue: "Riverside Community Auditorium",
      defaultLocation: "Riverside Rehearsal Hall, Room B",
      status: "rehearsals",
      firstRehearsal: dateStr(-14),
      openingDate: dateStr(45),
      closingDate: dateStr(47),
      accentColor: "#b45309",
    })
    .returning();

  await db.insert(s.creativeTeam).values([
    { productionId: pirates.id, userId: director.id, title: "Director" },
    { productionId: pirates.id, userId: choreo.id, title: "Choreographer" },
    { productionId: pirates.id, userId: musicDir.id, title: "Music Director" },
    { productionId: pirates.id, userId: sm.id, title: "Stage Manager" },
  ]);

  /* People */
  const mkPerson = async (firstName: string, lastName: string, extra: Partial<typeof s.people.$inferInsert> = {}) => {
    const [p] = await db.insert(s.people).values({ orgId: org.id, firstName, lastName, ...extra }).returning();
    return p;
  };
  const dana = await mkPerson("Dana", "Rivera", { userId: parentDana.id, email: "dana@family.dev", phone: "555-0101" });
  const marcus = await mkPerson("Marcus", "Webb", { userId: parentMarcus.id, email: "marcus@family.dev", phone: "555-0102" });
  const maya = await mkPerson("Maya", "Rivera", { isMinor: true, birthYear: 2012 });
  const leo = await mkPerson("Leo", "Rivera", { isMinor: true, birthYear: 2015 });
  const sam = await mkPerson("Sam", "Chen", { userId: teenSam.id, isMinor: true, birthYear: 2009, email: "sam@family.dev" });
  const ava = await mkPerson("Ava", "Webb", { isMinor: true, birthYear: 2011 });
  await db.insert(s.guardianships).values([
    { guardianId: dana.id, minorId: maya.id, relationship: "Mother" },
    { guardianId: dana.id, minorId: leo.id, relationship: "Mother" },
    { guardianId: marcus.id, minorId: ava.id, relationship: "Father" },
  ]);

  const named: Record<string, typeof s.people.$inferSelect> = { maya, leo, sam, ava };
  const extraNames = [
    ["Theo", "Barnes"], ["Isla", "Moreno"], ["Noah", "Fitzgerald"], ["Ruby", "Okonkwo"], ["Eli", "Park"],
    ["Hazel", "Duarte"], ["Finn", "Gallagher"], ["Zoe", "Abernathy"], ["Owen", "Takahashi"], ["Lila", "Brennan"],
    ["Miles", "Okafor"], ["Nora", "Castillo"], ["Jude", "Lindqvist"], ["Quinn", "Harper"], ["Iris", "Novak"],
    ["Caleb", "Ashby"], ["Mila", "Sorensen"], ["Ezra", "Whitfield"], ["Poppy", "Delgado"], ["Rowan", "Achebe"],
    ["Sadie", "Kowalski"], ["Arlo", "Mendez"], ["June", "Halvorsen"], ["Felix", "Oyelaran"],
  ];
  const extras: (typeof s.people.$inferSelect)[] = [];
  for (const [i, [f, l]] of extraNames.entries()) {
    const adult = i === 0; // Theo Barnes is an adult community member
    extras.push(await mkPerson(f, l, { isMinor: !adult, birthYear: adult ? 1985 : 2008 + (i % 8), email: `${f.toLowerCase()}@family.dev` }));
  }

  /* Roles */
  const roleDefs: [string, typeof s.roleKind.enumValues[number], string][] = [
    ["Major-General Stanley", "lead", "The very model of a modern Major-General"],
    ["The Pirate King", "lead", "Swashbuckling, soft-hearted captain"],
    ["Frederic", "lead", "Pirate apprentice bound by duty"],
    ["Mabel", "lead", "Stanley's daughter; coloratura soprano"],
    ["Ruth", "supporting", "Piratical maid-of-all-work"],
    ["Samuel", "supporting", "The Pirate King's lieutenant"],
    ["Sergeant of Police", "supporting", "Leads the reluctant constabulary"],
    ["Edith", "featured", "Stanley's daughter"],
    ["Kate", "featured", "Stanley's daughter"],
    ["Isabel", "featured", "Stanley's daughter"],
    ["Pirates", "ensemble", "Pirate chorus"],
    ["Daughters", "ensemble", "Stanley's other daughters"],
    ["Police", "ensemble", "Police chorus"],
  ];
  const roleRows = await db
    .insert(s.roles)
    .values(roleDefs.map(([name, kind, description], i) => ({ productionId: pirates.id, name, kind, description, sortOrder: i })))
    .returning();
  const R = Object.fromEntries(roleRows.map((r) => [r.name, r]));

  const assign = (role: string, people: (typeof s.people.$inferSelect)[], kind: "primary" | "understudy" | "swing" = "primary") =>
    people.map((p) => ({ roleId: R[role].id, personId: p.id, kind }));
  const e = extras;
  const assignRows: (typeof s.roleAssignments.$inferInsert)[] = [
    ...assign("Major-General Stanley", [e[0]]),
    ...assign("The Pirate King", [e[1]]),
    ...assign("Frederic", [named.sam]),
    ...assign("Frederic", [e[6]], "understudy"),
    ...assign("Mabel", [named.maya]),
    ...assign("Mabel", [e[9]], "understudy"),
    ...assign("Ruth", [e[3]]),
    ...assign("Samuel", [e[4]]),
    ...assign("Sergeant of Police", [e[2]]),
    ...assign("Edith", [named.ava]),
    ...assign("Kate", [e[5]]),
    ...assign("Isabel", [e[7]]),
    ...assign("Pirates", [named.leo, e[6], e[8], e[10], e[12], e[14], e[16], e[18]]),
    ...assign("Daughters", [e[9], e[11], e[13], e[15], e[17], e[19]]),
    // doubling: several pirates are also police (common in G&S)
    ...assign("Police", [named.leo, e[8], e[20], e[21], e[22], e[23]]),
  ];
  await db.insert(s.roleAssignments).values(assignRows);

  /* Groups */
  const [gPirates, gDaughters, gPolice] = await db
    .insert(s.roleGroups)
    .values([
      { productionId: pirates.id, name: "Pirate Band", color: "#b91c1c" },
      { productionId: pirates.id, name: "Stanley Family", color: "#7c3aed" },
      { productionId: pirates.id, name: "Constabulary", color: "#1d4ed8" },
    ])
    .returning();
  const groupMemberRows = [
    ...["The Pirate King", "Samuel", "Pirates"].map((r) => ({ groupId: gPirates.id, roleId: R[r].id })),
    ...["Major-General Stanley", "Mabel", "Edith", "Kate", "Isabel", "Daughters"].map((r) => ({ groupId: gDaughters.id, roleId: R[r].id })),
    ...["Sergeant of Police", "Police"].map((r) => ({ groupId: gPolice.id, roleId: R[r].id })),
  ];
  await db.insert(s.roleGroupMembers).values(groupMemberRows);

  /* Scenes */
  const ALL = roleDefs.map(([n]) => n);
  const sceneDefs: [number, string, string, string, string[]][] = [
    [1, "1", "The Pirate Sherry", "Pour, O Pour the Pirate Sherry", ["Pirates", "Samuel", "Frederic", "The Pirate King"]],
    [1, "2", "A Little Lad", "When Frederic Was a Little Lad", ["Ruth", "Frederic", "The Pirate King", "Samuel", "Pirates"]],
    [1, "3", "Pirate King", "Oh, Better Far to Live and Die", ["The Pirate King", "Pirates", "Samuel"]],
    [1, "4", "Rocky Mountain", "Climbing Over Rocky Mountain", ["Edith", "Kate", "Isabel", "Daughters", "Frederic"]],
    [1, "5", "Poor Wand'ring One", "Poor Wand'ring One", ["Mabel", "Frederic", "Edith", "Kate", "Isabel", "Daughters"]],
    [1, "6", "The Very Model", "I Am the Very Model of a Modern Major-General", ["Major-General Stanley", "The Pirate King", "Mabel", "Daughters", "Pirates", "Samuel"]],
    [1, "7", "Act One Finale", "Oh, Men of Dark and Dismal Fate", ALL.filter((r) => !["Sergeant of Police", "Police"].includes(r))],
    [2, "1", "The Ruined Chapel", "Oh, Dry the Glist'ning Tear", ["Major-General Stanley", "Mabel", "Edith", "Kate", "Isabel", "Daughters", "Frederic"]],
    [2, "2", "The Foeman", "When the Foeman Bares His Steel", ["Sergeant of Police", "Police", "Mabel", "Daughters", "Major-General Stanley"]],
    [2, "3", "A Paradox", "When You Had Left Our Pirate Fold; A Paradox", ["Ruth", "The Pirate King", "Frederic"]],
    [2, "4", "Stay, Frederic", "Stay, Frederic, Stay; Ah, Leave Me Not to Pine", ["Mabel", "Frederic"]],
    [2, "5", "A Policeman's Lot", "When a Felon's Not Engaged in His Employment", ["Sergeant of Police", "Police", "Mabel"]],
    [2, "6", "Cat-Like Tread", "With Cat-Like Tread; Sighing Softly to the River", ["The Pirate King", "Samuel", "Pirates", "Major-General Stanley", "Sergeant of Police", "Police", "Frederic", "Ruth"]],
    [2, "7", "Act Two Finale", "Poor Wand'ring Ones (Reprise)", ALL],
  ];
  const sceneRows = await db
    .insert(s.scenes)
    .values(sceneDefs.map(([act, number, name, songs], i) => ({ productionId: pirates.id, act, number, name, songs, sortOrder: i })))
    .returning();
  await db.insert(s.sceneRoles).values(sceneDefs.flatMap(([, , , , rs], i) => rs.map((r) => ({ sceneId: sceneRows[i].id, roleId: R[r].id }))));
  const S = (act: number, n: string) => sceneRows.find((x) => x.act === act && x.number === n)!;

  /* Events: Mon/Wed evenings + Saturdays for the 2 weeks back and 3 weeks ahead */
  type Call = { target: typeof s.callTarget.enumValues[number]; targetId: string | null };
  type BlockDef = { from: [number, number]; to: [number, number]; title?: string; leader?: string; calls: Call[] };
  const sc = (act: number, n: string): Call => ({ target: "scene", targetId: S(act, n).id });
  const grp = (g: { id: string }): Call => ({ target: "group", targetId: g.id });
  const role = (name: string): Call => ({ target: "role", targetId: R[name].id });
  const ALLCAST: Call = { target: "all_cast", targetId: null };

  const created: { event: typeof s.events.$inferSelect; blocks: { startsAt: Date; endsAt: Date; calls: Call[] }[] }[] = [];
  const mkEvent = async (
    day: number,
    kind: typeof s.eventKind.enumValues[number],
    title: string,
    from: [number, number],
    to: [number, number],
    blocks: BlockDef[],
    opts: {
      status?: "draft" | "published" | "cancelled";
      notes?: string;
      location?: string;
      revision?: number;
      changeNote?: string;
      changedAt?: Date;
    } = {},
  ) => {
    const status = opts.status ?? "published";
    const [ev] = await db
      .insert(s.events)
      .values({
        productionId: pirates.id,
        kind,
        title,
        startsAt: at(day, ...from),
        endsAt: at(day, ...to),
        location: opts.location ?? pirates.defaultLocation,
        notes: opts.notes,
        status,
        publishedAt: status === "draft" ? null : at(day - 5, 9),
        revision: opts.revision ?? 0,
        changeNote: opts.changeNote ?? null,
        changedAt: opts.changedAt ?? (status === "cancelled" ? at(day - 3, 12) : null),
      })
      .returning();
    created.push({ event: ev, blocks: blocks.map((b) => ({ startsAt: at(day, ...b.from), endsAt: at(day, ...b.to), calls: b.calls })) });
    for (const [i, b] of blocks.entries()) {
      const [blk] = await db
        .insert(s.eventBlocks)
        .values({ eventId: ev.id, startsAt: at(day, ...b.from), endsAt: at(day, ...b.to), title: b.title, leader: b.leader, sortOrder: i })
        .returning();
      if (b.calls.length) await db.insert(s.blockCalls).values(b.calls.map((c) => ({ blockId: blk.id, ...c })));
    }
    return ev;
  };

  // Find the weekday offsets relative to today
  const todayDow = new TZDate(Date.now(), TZ).getDay();
  const offsetsFor = (dow: number) => {
    const out: number[] = [];
    for (let d = -14; d <= 21; d++) if ((((todayDow + d) % 7) + 7) % 7 === dow) out.push(d);
    return out;
  };
  const mondays = offsetsFor(1);
  const wednesdays = offsetsFor(3);
  const saturdays = offsetsFor(6);

  const weekPlans: { mon: BlockDef[]; wed: BlockDef[]; sat: BlockDef[] }[] = [
    {
      mon: [
        { from: [18, 0], to: [19, 0], title: "Read-through & music: Act 1", leader: "Music Director", calls: [ALLCAST] },
        { from: [19, 0], to: [21, 0], calls: [sc(1, "1"), sc(1, "2")], leader: "Director" },
      ],
      wed: [
        { from: [18, 0], to: [19, 30], calls: [sc(1, "4"), sc(1, "5")], leader: "Director" },
        { from: [19, 30], to: [21, 0], calls: [sc(1, "3")], leader: "Choreographer" },
      ],
      sat: [
        { from: [10, 0], to: [12, 0], title: "Act 1 music review", leader: "Music Director", calls: [grp(gPirates), grp(gDaughters)] },
        { from: [12, 30], to: [14, 0], calls: [sc(1, "6")], leader: "Choreographer" },
      ],
    },
    {
      mon: [
        { from: [18, 0], to: [19, 0], calls: [sc(1, "7")], leader: "Director" },
        { from: [19, 0], to: [21, 0], calls: [sc(2, "1"), sc(2, "4")], leader: "Director" },
      ],
      wed: [
        { from: [18, 0], to: [19, 30], calls: [sc(2, "2"), sc(2, "5")], leader: "Choreographer" },
        { from: [19, 30], to: [21, 0], calls: [sc(2, "3")], leader: "Director" },
      ],
      sat: [
        { from: [10, 0], to: [11, 30], calls: [sc(2, "6")], leader: "Choreographer" },
        { from: [11, 30], to: [14, 0], title: "Act 2 stumble-through", leader: "Director", calls: [ALLCAST] },
      ],
    },
    {
      mon: [
        { from: [18, 0], to: [19, 0], title: "Leads vocal session", leader: "Music Director", calls: [role("Mabel"), role("Frederic"), role("The Pirate King"), role("Major-General Stanley")] },
        { from: [19, 0], to: [21, 0], calls: [sc(1, "5"), sc(1, "6")], leader: "Director" },
      ],
      wed: [
        { from: [18, 0], to: [19, 0], title: "Police choreography", leader: "Choreographer", calls: [grp(gPolice)] },
        { from: [19, 0], to: [21, 0], calls: [sc(2, "6"), sc(2, "7")], leader: "Director" },
      ],
      sat: [{ from: [10, 0], to: [14, 0], title: "Act 1 run", leader: "Director", calls: [ALLCAST] }],
    },
    {
      mon: [
        { from: [18, 0], to: [19, 30], calls: [sc(1, "1"), sc(1, "3")], leader: "Choreographer" },
        { from: [19, 30], to: [21, 0], calls: [sc(2, "3"), sc(2, "4")], leader: "Director" },
      ],
      wed: [{ from: [18, 0], to: [21, 0], title: "Act 2 run", leader: "Director", calls: [ALLCAST] }],
      sat: [{ from: [10, 0], to: [14, 0], title: "Full run-through", leader: "Director", calls: [ALLCAST] }],
    },
    {
      mon: [{ from: [18, 0], to: [21, 0], title: "Notes & problem scenes", leader: "Director", calls: [sc(1, "7"), sc(2, "7")] }],
      wed: [{ from: [18, 0], to: [21, 0], title: "Full run", leader: "Director", calls: [ALLCAST] }],
      sat: [{ from: [10, 0], to: [14, 0], title: "Full run with props", leader: "Stage Manager", calls: [ALLCAST] }],
    },
    {
      mon: [{ from: [18, 0], to: [21, 0], title: "Full run", leader: "Director", calls: [ALLCAST] }],
      wed: [{ from: [18, 0], to: [21, 0], title: "Full run", leader: "Director", calls: [ALLCAST] }],
      sat: [{ from: [10, 0], to: [14, 0], title: "Full run", leader: "Director", calls: [ALLCAST] }],
    },
  ];

  let updatedWednesday: typeof s.events.$inferSelect | null = null;
  const weeks = Math.max(mondays.length, wednesdays.length, saturdays.length);
  for (let w = 0; w < weeks; w++) {
    const plan = weekPlans[Math.min(w, weekPlans.length - 1)];
    // Next week's schedule (more than ~10 days out) is still a draft
    const statusFor = (d: number) => (d > 10 ? "draft" : "published") as "draft" | "published";
    if (mondays[w] !== undefined) {
      const d = mondays[w];
      await mkEvent(d, "rehearsal", "Rehearsal", [18, 0], [21, 0], plan.mon, { status: statusFor(d) });
    }
    if (wednesdays[w] !== undefined) {
      const d = wednesdays[w];
      // One Wednesday in the near future was moved 30 minutes earlier after publishing: it carries a
      // revision, a change note and an event_changes row (written below) so families see "Changed".
      const updated = d > 0 && d <= 7;
      const ev = await mkEvent(d, "rehearsal", "Rehearsal", [18, 0], [21, 0], plan.wed, {
        status: statusFor(d),
        revision: updated ? 1 : 0,
        changeNote: updated ? "We're starting 30 minutes earlier to fit in extra choreography." : undefined,
        changedAt: updated ? at(-1, 15) : undefined,
      });
      if (updated) updatedWednesday = ev;
    }
    if (saturdays[w] !== undefined) {
      const d = saturdays[w];
      await mkEvent(d, "rehearsal", "Saturday Rehearsal", [10, 0], [14, 0], plan.sat, {
        status: statusFor(d),
        notes: "Bring a lunch and water bottle.",
      });
    }
  }

  // A cancelled rehearsal (Thursday this week if in the future) + a costume fitting
  // Cancelled after publishing, the way the cancel flow leaves it: revision bumped, reason in
  // changeNote, and an event_changes row (written below) for everyone who was called.
  const cancelledExtra = await mkEvent(2, "rehearsal", "Extra Rehearsal — Daughters", [16, 0], [17, 30], [
    { from: [16, 0], to: [17, 30], calls: [grp(gDaughters)], leader: "Music Director" },
  ], { status: "cancelled", revision: 1, changeNote: "Auditorium unavailable", changedAt: at(-1, 12) });
  await mkEvent(4, "fitting", "Costume Fittings — Pirates", [15, 30], [17, 0], [
    { from: [15, 30], to: [16, 15], title: "Pirate leads", calls: [role("The Pirate King"), role("Samuel"), role("Ruth")] },
    { from: [16, 15], to: [17, 0], title: "Pirate chorus", calls: [role("Pirates")] },
  ], { location: "Costume Shop" });

  // Tech, dress and shows
  await mkEvent(42, "tech", "Tech Rehearsal", [17, 0], [21, 30], [
    { from: [17, 0], to: [21, 30], title: "Cue-to-cue", calls: [ALLCAST] },
  ], { status: "draft", location: pirates.venue! });
  await mkEvent(44, "dress", "Final Dress", [17, 0], [21, 30], [
    { from: [17, 0], to: [21, 30], title: "Final dress", calls: [ALLCAST] },
  ], { status: "draft", location: pirates.venue! });
  for (const [d, h, label] of [[45, 19, "Opening Night"], [46, 19, "Performance"], [47, 14, "Closing Matinee"]] as const) {
    await mkEvent(d, "performance", label, [h - 1, 30], [h + 2, 30], [
      { from: [h - 1, 30], to: [h + 2, 30], title: "Call — hair, makeup, mic check", calls: [ALLCAST] },
    ], { status: "published", location: pirates.venue! });
  }

  /* Conflicts */
  await db.insert(s.conflicts).values([
    { personId: e[3].id, productionId: pirates.id, startsAt: at(9, 18), endsAt: at(9, 19, 30), note: "Ruth: work until 7:30", createdByUserId: orgAdmin.id },
    { personId: maya.id, productionId: pirates.id, startsAt: at(12, 9), endsAt: at(12, 12), note: "Soccer tournament", createdByUserId: parentDana.id },
  ]);

  await db.insert(s.announcements).values([
    { productionId: pirates.id, authorUserId: director.id, title: "Off-book for Act 1 by next Monday", body: "Please have all Act 1 lines and lyrics memorized. Scripts down!", pinned: true },
    { productionId: pirates.id, authorUserId: sm.id, title: "Parking", body: "Use the north lot; the main lot is closed for paving through the month." },
  ]);

  /*
   * Who each event calls. Mirrors resolveTarget in src/lib/calls.ts (which is server-only, so the
   * seed can't import it): scene/group calls skip understudies, role calls include them.
   */
  const rolesByScene = new Map<string, string[]>();
  sceneDefs.forEach(([, , , , rs], i) => rolesByScene.set(sceneRows[i].id, rs.map((r) => R[r].id)));
  const rolesByGroup = new Map<string, string[]>();
  for (const m of groupMemberRows) rolesByGroup.set(m.groupId, [...(rolesByGroup.get(m.groupId) ?? []), m.roleId]);
  const castIds = [...new Set(assignRows.map((a) => a.personId))];
  const resolve = (c: Call): string[] => {
    const byRoles = (roleIds: string[], withUnderstudies: boolean) =>
      assignRows.filter((a) => roleIds.includes(a.roleId) && (withUnderstudies || a.kind !== "understudy")).map((a) => a.personId);
    switch (c.target) {
      case "all_cast":
        return castIds;
      case "person":
        return c.targetId ? [c.targetId] : [];
      case "role":
        return byRoles([c.targetId!], true);
      case "scene":
        return byRoles(rolesByScene.get(c.targetId!) ?? [], false);
      case "group":
        return byRoles(rolesByGroup.get(c.targetId!) ?? [], false);
    }
  };
  /** personId → call/release for an event, the way the call engine computes it. */
  const callsFor = (blocks: (typeof created)[number]["blocks"]) => {
    const out = new Map<string, { callAt: Date; releaseAt: Date }>();
    for (const b of blocks)
      for (const pid of new Set(b.calls.flatMap(resolve))) {
        const cur = out.get(pid);
        if (!cur) out.set(pid, { callAt: b.startsAt, releaseAt: b.endsAt });
        else {
          if (b.startsAt < cur.callAt) cur.callAt = b.startsAt;
          if (b.endsAt > cur.releaseAt) cur.releaseAt = b.endsAt;
        }
      }
    return out;
  };
  const personById = new Map([dana, marcus, maya, leo, sam, ava, ...extras].map((p) => [p.id, p]));

  /* Change log: the moved Wednesday. Before the change everyone called at 6:00 was called at 6:30. */
  if (updatedWednesday) {
    const ev = updatedWednesday;
    const calls = callsFor(created.find((c) => c.event.id === ev.id)!.blocks);
    const affected = [...calls].filter(([, c]) => +c.callAt === +ev.startsAt);
    const was = new Date(+ev.startsAt + 30 * 60_000);
    await db.insert(s.eventChanges).values({
      eventId: ev.id,
      productionId: pirates.id,
      revision: 1,
      summary: `Start moved ${fmtTime(was, TZ)} → ${fmtTime(ev.startsAt, TZ)}`,
      affectedPersonIds: affected.map(([pid]) => pid),
      personSummaries: Object.fromEntries(
        affected.map(([pid, c]) => [pid, `Now called ${fmtRange(c.callAt, c.releaseAt, TZ)} (was ${fmtRange(was, c.releaseAt, TZ)})`]),
      ),
      changedByUserId: director.id,
      createdAt: at(-1, 15),
    });
    // Sam has already tapped "Got it"; Dana (Leo/Maya) has not, so her home shows the change.
    if (affected.some(([pid]) => pid === sam.id)) {
      await db.insert(s.changeAcks).values({ userId: teenSam.id, eventId: ev.id, revision: 1, ackedAt: at(-1, 18) });
    }
  }

  {
    // Everyone the cancelled extra rehearsal had called (Stanley Family group: Maya, Ava, the daughters…).
    const was = [...callsFor(created.find((c) => c.event.id === cancelledExtra.id)!.blocks).keys()];
    const line = `Cancelled — ${cancelledExtra.changeNote}`;
    await db.insert(s.eventChanges).values({
      eventId: cancelledExtra.id,
      productionId: pirates.id,
      revision: 1,
      summary: line,
      affectedPersonIds: was,
      personSummaries: Object.fromEntries(was.map((pid) => [pid, line])),
      changedByUserId: musicDir.id,
      createdAt: at(-1, 12),
    });
  }

  /* Attendance for past published rehearsals, taken by the stage manager */
  const now = new Date();
  const pastRehearsals = created
    .filter((c) => c.event.status === "published" && c.event.kind === "rehearsal" && c.event.endsAt < now)
    .sort((a, b) => +a.event.startsAt - +b.event.startsAt);
  const pickupBy: Record<string, string> = { [maya.id]: "Dana Rivera", [leo.id]: "Dana Rivera", [ava.id]: "Marcus Webb" };
  const attendanceRows: (typeof s.attendance.$inferInsert)[] = [];
  pastRehearsals.forEach((c, ei) => {
    [...callsFor(c.blocks)].forEach(([pid, call], pi) => {
      const p = personById.get(pid)!;
      // Deterministic variety: Maya excused once (dentist), a few late arrivals, one no-show.
      let status: "present" | "late" | "absent" | "excused" = "present";
      let note: string | null = null;
      if (pid === maya.id && ei === 1) [status, note] = ["excused", "Dentist appointment (told SM ahead)"];
      else if ((pi + ei * 3) % 13 === 5) [status, note] = ["late", "Traffic"];
      else if ((pi + ei) % 29 === 11) status = "absent";
      const inAt = status === "late" ? new Date(+call.callAt + 12 * 60_000) : call.callAt;
      const here = status === "present" || status === "late";
      attendanceRows.push({
        eventId: c.event.id,
        personId: pid,
        status,
        checkedInAt: here ? inAt : null,
        checkedOutAt: here ? call.releaseAt : null,
        pickedUpBy: here && p.isMinor ? (pickupBy[pid] ?? `Parent of ${p.firstName}`) : null,
        markedByUserId: sm.id,
        note,
      });
    });
  });
  if (attendanceRows.length) await db.insert(s.attendance).values(attendanceRows);

  /* Actor notes (one unread: Leo's) and last week's published rehearsal report */
  const lastRehearsal = pastRehearsals.at(-1)?.event ?? null;
  const notes: { by: string; cat: string; body: string; to: string[]; scene?: string; read: boolean; ago: number }[] = [
    {
      by: musicDir.id,
      cat: "music",
      body: "Cadenza in “Poor Wand'ring One”: breathe after “one”, not before the run. The high notes were lovely tonight.",
      to: [maya.id],
      scene: S(1, "5").id,
      read: true,
      ago: 6,
    },
    {
      by: director.id,
      cat: "blocking",
      body: "On “Oh, is there not one maiden breast”, cross down left so Mabel can enter upstage of you.",
      to: [sam.id],
      scene: S(1, "5").id,
      read: true,
      ago: 6,
    },
    {
      by: director.id,
      cat: "character",
      body: "“Stay, Frederic, Stay”: play the goodbye as if it's forever. Take your time on the last “Ah, leave me not to pine”.",
      to: [maya.id, sam.id],
      scene: S(2, "4").id,
      read: true,
      ago: 3,
    },
    {
      by: choreo.id,
      cat: "choreo",
      body: "Police: the stomp on “Tarantara” lands on beat 3, not 1. Practice with the video under Rehearsal materials.",
      to: [leo.id],
      scene: S(2, "2").id,
      read: false,
      ago: 1,
    },
  ];
  for (const n of notes) {
    const [row] = await db
      .insert(s.actorNotes)
      .values({
        productionId: pirates.id,
        eventId: lastRehearsal?.id ?? null,
        sceneId: n.scene ?? null,
        authorUserId: n.by,
        category: n.cat,
        body: n.body,
        createdAt: at(-n.ago, 21, 15),
      })
      .returning();
    await db
      .insert(s.actorNoteRecipients)
      .values(n.to.map((personId) => ({ noteId: row.id, personId, readAt: n.read ? at(-n.ago + 1, 8) : null })));
  }

  const lastWeek = [...pastRehearsals].reverse().find((c) => c.event.startsAt >= at(-8, 0) && c.event.endsAt <= at(-1, 23));
  if (lastWeek) {
    const covered = [...new Set(lastWeek.blocks.flatMap((b) => b.calls.filter((c) => c.target === "scene").map((c) => c.targetId!)))];
    await db.insert(s.rehearsalReports).values({
      productionId: pirates.id,
      eventId: lastWeek.event.id,
      authorUserId: sm.id,
      summary:
        "Good energy and focus. Started 5 minutes late (hall unlocked late). Worked the scheduled scenes; Act 2 Sc 3 needs another pass on the paradox patter.",
      scenesCovered: covered,
      departmentNotes: {
        costumes: "Pirate King's hat is too big. Needs foam or a smaller size.",
        props: "Need 6 more rehearsal swords for the pirate chorus; 2 handles cracked.",
        music: "Piano in Room B is a quarter-tone flat. Requested a tuning before Saturday.",
      },
      createdAt: new Date(+lastWeek.event.endsAt + 30 * 60_000),
      publishedAt: new Date(+lastWeek.event.endsAt + 60 * 60_000),
    });
  }

  /* Resources (links only) */
  const yt = (q: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q).replace(/%20/g, "+")}`;
  await db.insert(s.resources).values([
    { productionId: pirates.id, title: "Full show reference recordings", url: yt("pirates of penzance full show"), kind: "video", sortOrder: 1 },
    {
      productionId: pirates.id,
      title: "Libretto (public domain)",
      url: "https://www.gutenberg.org/ebooks/search/?query=pirates+of+penzance",
      kind: "script",
      sortOrder: 2,
    },
    {
      productionId: pirates.id,
      title: "Poor Wand'ring One — reference recordings",
      url: yt("poor wand'ring one pirates of penzance"),
      kind: "video",
      roleId: R["Mabel"].id,
      sortOrder: 3,
    },
    {
      productionId: pirates.id,
      title: "Pour, O Pour the Pirate Sherry — reference recordings",
      url: yt("pour o pour the pirate sherry"),
      kind: "video",
      sceneId: S(1, "1").id,
      sortOrder: 4,
    },
    {
      productionId: pirates.id,
      title: "Modern Major-General patter — slow practice",
      url: yt("modern major general slow practice"),
      kind: "track",
      roleId: R["Major-General Stanley"].id,
      sortOrder: 5,
    },
    {
      productionId: pirates.id,
      title: "When the Foeman Bares His Steel (Tarantara) — choreo reference",
      url: yt("when the foeman bares his steel tarantara"),
      kind: "video",
      sceneId: S(2, "2").id,
      sortOrder: 6,
    },
    {
      productionId: pirates.id,
      title: "A Paradox — trio reference",
      url: yt("pirates of penzance a paradox trio"),
      kind: "video",
      sceneId: S(2, "3").id,
      sortOrder: 7,
    },
  ]);

  /* Volunteers: performance-night shifts, ongoing crew, and a 6-hour family ask */
  await db.insert(s.volunteerSettings).values({ productionId: pirates.id, requiredHours: 6 });
  const shiftRows = await db
    .insert(s.volunteerShifts)
    .values([
      { productionId: pirates.id, title: "Concessions — Opening Night", description: "Sell snacks and drinks before the show and at intermission.", startsAt: at(45, 18), endsAt: at(45, 21, 30), location: "Lobby", capacity: 3 },
      { productionId: pirates.id, title: "Box office — Opening Night", description: "Scan tickets and handle will-call.", startsAt: at(45, 18), endsAt: at(45, 19, 30), location: "Lobby", capacity: 2 },
      { productionId: pirates.id, title: "Backstage chaperone — Final Dress", description: "Supervise the dressing rooms; quiet backstage.", startsAt: at(44, 17), endsAt: at(44, 21, 30), location: "Dressing rooms", capacity: 4 },
      { productionId: pirates.id, title: "Ushers — Closing Matinee", description: "Hand out programs and help with seating.", startsAt: at(47, 13), endsAt: at(47, 16, 30), location: "House", capacity: 4 },
      { productionId: pirates.id, title: "Set build Saturday", description: "Painting and assembly. Wear clothes that can get paint on them.", startsAt: at(11, 9), endsAt: at(11, 13), location: "Scene shop", capacity: 8 },
      { productionId: pirates.id, title: "Costume crew", description: "Sewing, alterations and laundry across the run. Work from home welcome.", capacity: 4, creditMinutes: 360 },
      { productionId: pirates.id, title: "Snack coordinator", description: "Organize the rehearsal snack rota for the cast.", capacity: 1, creditMinutes: 120 },
    ])
    .returning();
  const shift = (title: string) => shiftRows.find((x) => x.title === title)!;
  await db.insert(s.volunteerSignups).values([
    { shiftId: shift("Concessions — Opening Night").id, userId: parentDana.id, personId: maya.id, note: "Can bring a cash box." },
    { shiftId: shift("Costume crew").id, userId: parentMarcus.id, personId: ava.id },
    { shiftId: shift("Set build Saturday").id, userId: parentMarcus.id, personId: ava.id },
  ]);

  /* Second production in auditions */
  const [dream] = await db
    .insert(s.productions)
    .values({
      orgId: org.id,
      title: "A Midsummer Night's Dream",
      subtitle: "Spring Play",
      description: "Shakespeare's comedy of lovers, fairies and rude mechanicals.",
      venue: "Riverside Community Auditorium",
      defaultLocation: "Riverside Rehearsal Hall, Room A",
      status: "auditions",
      openingDate: dateStr(160),
      closingDate: dateStr(162),
      accentColor: "#047857",
    })
    .returning();
  await db.insert(s.creativeTeam).values([{ productionId: dream.id, userId: director.id, title: "Director" }]);
  await db.insert(s.roles).values(
    [
      ["Puck", "lead"], ["Oberon", "lead"], ["Titania", "lead"], ["Bottom", "lead"], ["Hermia", "supporting"],
      ["Helena", "supporting"], ["Lysander", "supporting"], ["Demetrius", "supporting"], ["Fairies", "ensemble"], ["Mechanicals", "ensemble"],
    ].map(([name, kind], i) => ({ productionId: dream.id, name, kind: kind as "lead", sortOrder: i })),
  );
  const [aud] = await db
    .insert(s.auditions)
    .values({
      productionId: dream.id,
      slug: "midsummer-auditions",
      title: "Midsummer Auditions",
      description: "Prepare a 1-minute Shakespeare monologue (we'll provide sides if you don't have one). Ages 10–18. Wear clothes you can move in.",
      location: "Riverside Rehearsal Hall, Room A",
      isOpen: true,
      questions: [
        { id: "monologue", label: "Which monologue will you perform?", type: "text" },
        { id: "crew", label: "I'd also like to be considered for crew", type: "checkbox" },
      ],
    })
    .returning();
  const slots = await db
    .insert(s.auditionSlots)
    .values([
      ...[0, 1, 2, 3, 4, 5].map((i) => ({ auditionId: aud.id, kind: "audition" as const, startsAt: at(10, 16, i * 15), endsAt: at(10, 16, i * 15 + 15), capacity: 2 })),
      ...[0, 1, 2, 3].map((i) => ({ auditionId: aud.id, kind: "audition" as const, startsAt: at(12, 10, i * 20), endsAt: at(12, 10, i * 20 + 20), capacity: 3 })),
      { auditionId: aud.id, kind: "callback" as const, startsAt: at(15, 17), endsAt: at(15, 19), capacity: 20, label: "Callbacks: lovers & fairies" },
    ])
    .returning();
  const auditioners = [
    ["Harper", "Quill", 14], ["Milo", "Fenwick", 12], ["Clara", "Ostrander", 16], ["Jonah", "Pryce", 11], ["Wren", "Castellano", 15],
  ] as const;
  // Two auditioners list known conflicts at signup (copied into `conflicts` if they're cast).
  const conflictDatesFor: Record<number, (typeof s.auditionSignups.$inferInsert)["conflictDates"]> = {
    0: [
      { date: dateStr(20), allDay: false, start: "17:00", end: "19:00", weekly: true, note: "Piano lessons (Tuesdays)" },
      { date: dateStr(34), allDay: true, note: "Family wedding" },
    ],
    2: [{ date: dateStr(27), allDay: true, note: "Debate tournament" }],
  };
  for (const [i, [f, l, age]] of auditioners.entries()) {
    await db.insert(s.auditionSignups).values({
      auditionId: aud.id,
      slotId: slots[i % 6].id,
      firstName: f,
      lastName: l,
      email: `${f.toLowerCase()}@family.dev`,
      age,
      guardianName: `Parent of ${f}`,
      guardianEmail: `parent.${f.toLowerCase()}@family.dev`,
      rolesInterested: i % 2 ? "Puck, Fairies" : "Helena, Hermia",
      experience: "School plays, summer camp",
      answers: { monologue: "Puck's epilogue", crew: i === 3 },
      conflictDates: conflictDatesFor[i] ?? [],
      manageToken: tok(),
    });
  }
  // Leo also signed up for the next show
  await db.insert(s.auditionSignups).values({
    auditionId: aud.id, slotId: slots[1].id, firstName: "Leo", lastName: "Rivera", email: "dana@family.dev", age: 11,
    guardianName: "Dana Rivera", guardianEmail: "dana@family.dev", rolesInterested: "Mechanicals", personId: leo.id, manageToken: tok(),
  });

  /* A closed past show (last spring) with Maya and Ava, so families see "Past shows" on /productions */
  const [alice] = await db
    .insert(s.productions)
    .values({
      orgId: org.id,
      title: "Alice in Wonderland",
      subtitle: "Spring Musical (last year)",
      description: "A musical adaptation of Lewis Carroll's Alice books.",
      venue: "Riverside Community Auditorium",
      defaultLocation: "Riverside Rehearsal Hall, Room B",
      status: "closed",
      firstRehearsal: dateStr(-230),
      openingDate: dateStr(-180),
      closingDate: dateStr(-178),
      accentColor: "#0e7490",
    })
    .returning();
  await db.insert(s.creativeTeam).values([
    { productionId: alice.id, userId: director.id, title: "Director" },
    { productionId: alice.id, userId: sm.id, title: "Stage Manager" },
  ]);
  const aliceRoles = await db
    .insert(s.roles)
    .values(
      ([
        ["Alice", "lead"],
        ["The Mad Hatter", "lead"],
        ["The Queen of Hearts", "lead"],
        ["The Cheshire Cat", "supporting"],
        ["Cards", "ensemble"],
      ] as const).map(([name, kind], i) => ({ productionId: alice.id, name, kind, sortOrder: i })),
    )
    .returning();
  const AR = Object.fromEntries(aliceRoles.map((r) => [r.name, r]));
  await db.insert(s.roleAssignments).values([
    { roleId: AR["Alice"].id, personId: maya.id },
    { roleId: AR["The Mad Hatter"].id, personId: e[1].id },
    { roleId: AR["The Queen of Hearts"].id, personId: e[3].id },
    { roleId: AR["The Cheshire Cat"].id, personId: ava.id },
    ...[e[9], e[11], e[13], e[15]].map((p) => ({ roleId: AR["Cards"].id, personId: p.id })),
  ]);
  const aliceScene = (
    await db
      .insert(s.scenes)
      .values([
        { productionId: alice.id, act: 1, number: "1", name: "Down the Rabbit Hole", sortOrder: 0 },
        { productionId: alice.id, act: 1, number: "2", name: "A Mad Tea Party", sortOrder: 1 },
        { productionId: alice.id, act: 2, number: "1", name: "The Queen's Croquet Ground", sortOrder: 2 },
      ])
      .returning()
  )[0];
  await db.insert(s.sceneRoles).values([{ sceneId: aliceScene.id, roleId: AR["Alice"].id }]);
  for (const [d, label] of [[-180, "Opening Night"], [-178, "Closing Matinee"]] as const) {
    const [ev] = await db
      .insert(s.events)
      .values({
        productionId: alice.id,
        kind: "performance",
        title: label,
        startsAt: at(d, 18, 30),
        endsAt: at(d, 21, 30),
        location: alice.venue,
        status: "published",
        publishedAt: at(d - 30, 9),
      })
      .returning();
    const [blk] = await db
      .insert(s.eventBlocks)
      .values({ eventId: ev.id, startsAt: at(d, 18, 30), endsAt: at(d, 21, 30), title: "Call — hair, makeup, mic check" })
      .returning();
    await db.insert(s.blockCalls).values({ blockId: blk.id, target: "all_cast", targetId: null });
  }

  /* MCP API key for the org admin */
  const key = `ct_${tok(24)}`;
  await db.insert(s.apiKeys).values({ orgId: org.id, userId: orgAdmin.id, name: "Demo key", prefix: key.slice(0, 7), hash: sha(key) });

  console.log("Seeded.");
  console.log("Demo logins (password: calltime):");
  for (const u of [admin, orgAdmin, director, choreo, musicDir, sm, parentDana, parentMarcus, teenSam]) console.log(`  ${u.email.padEnd(26)} ${u.name}`);
  console.log(`Pirates production id: ${pirates.id}`);
  console.log(`MCP API key (org admin): ${key}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
