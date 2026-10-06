/**
 * Demo data: Riverside Youth Theatre with "The Pirates of Penzance" in rehearsals and
 * "A Midsummer Night's Dream" in auditions. WIPES ALL DATA. Every demo account's password is "calltime".
 *
 *   npm run db:seed
 */
import { createHash, randomBytes } from "node:crypto";
import { TZDate } from "@date-fns/tz";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import * as s from "../src/db/schema";

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
  await db.insert(s.roleAssignments).values([
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
  ]);

  /* Groups */
  const [gPirates, gDaughters, gPolice] = await db
    .insert(s.roleGroups)
    .values([
      { productionId: pirates.id, name: "Pirate Band", color: "#b91c1c" },
      { productionId: pirates.id, name: "Stanley Family", color: "#7c3aed" },
      { productionId: pirates.id, name: "Constabulary", color: "#1d4ed8" },
    ])
    .returning();
  await db.insert(s.roleGroupMembers).values([
    ...["The Pirate King", "Samuel", "Pirates"].map((r) => ({ groupId: gPirates.id, roleId: R[r].id })),
    ...["Major-General Stanley", "Mabel", "Edith", "Kate", "Isabel", "Daughters"].map((r) => ({ groupId: gDaughters.id, roleId: R[r].id })),
    ...["Sergeant of Police", "Police"].map((r) => ({ groupId: gPolice.id, roleId: R[r].id })),
  ]);

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

  const mkEvent = async (
    day: number,
    kind: typeof s.eventKind.enumValues[number],
    title: string,
    from: [number, number],
    to: [number, number],
    blocks: BlockDef[],
    opts: { status?: "draft" | "published" | "cancelled"; notes?: string; location?: string; revision?: number } = {},
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
      })
      .returning();
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
      // one Wednesday in the near future was moved: give it a revision to show the "Updated" badge
      const updated = d > 0 && d <= 7;
      await mkEvent(d, "rehearsal", "Rehearsal", [18, 0], [21, 0], plan.wed, {
        status: statusFor(d),
        revision: updated ? 2 : 0,
        notes: updated ? "Updated: Act 2 Sc 3 moved earlier so Ruth can leave at 7:30." : undefined,
      });
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
  await mkEvent(2, "rehearsal", "Extra Rehearsal — Daughters", [16, 0], [17, 30], [
    { from: [16, 0], to: [17, 30], calls: [grp(gDaughters)], leader: "Music Director" },
  ], { status: "cancelled", notes: "Cancelled — auditorium unavailable." });
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
      manageToken: tok(),
    });
  }
  // Leo also signed up for the next show
  await db.insert(s.auditionSignups).values({
    auditionId: aud.id, slotId: slots[1].id, firstName: "Leo", lastName: "Rivera", email: "dana@family.dev", age: 11,
    guardianName: "Dana Rivera", guardianEmail: "dana@family.dev", rolesInterested: "Mechanicals", personId: leo.id, manageToken: tok(),
  });

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
