import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/* ───────────────────────── Identity & tenancy ───────────────────────── */

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(), // always stored lowercase
  name: text("name").notNull(),
  phone: text("phone"),
  passwordHash: text("password_hash"), // null until the invite is accepted
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  /** Secret token for the personal iCalendar feed (/api/calendar/<token>). Rotatable. */
  calendarToken: text("calendar_token").notNull().unique(),
  createdAt: createdAt(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // sha256 of the cookie value
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

/** A tenant: a theater company / school / community group. */
export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  timezone: text("timezone").notNull().default("America/New_York"),
  createdAt: createdAt(),
});

export const orgRole = pgEnum("org_role", ["admin", "member"]);

export const orgMembers = pgTable(
  "org_members",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: orgRole("role").notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

/** Pending invitation. Shared as a link (/invite/<token>); email delivery is optional. */
export const invites = pgTable("invites", {
  id: id(),
  token: text("token").notNull().unique(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  name: text("name"),
  /** What accepting grants. */
  orgRole: orgRole("org_role").notNull().default("member"),
  productionId: uuid("production_id").references(() => productions.id, { onDelete: "cascade" }),
  creativeTitle: text("creative_title"), // if set, joins the production's creative team with this title
  personId: uuid("person_id").references(() => people.id, { onDelete: "cascade" }), // links the account to this person record
  guardianOfPersonId: uuid("guardian_of_person_id").references(() => people.id, { onDelete: "cascade" }),
  invitedByUserId: uuid("invited_by_user_id").references(() => users.id, { onDelete: "set null" }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

/** Hashed bearer tokens for the MCP endpoint. Scoped to one org, acting as one user. */
export const apiKeys = pgTable("api_keys", {
  id: id(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(), // first chars shown in UI, e.g. "ct_ab12"
  hash: text("hash").notNull().unique(), // sha256 of full key
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/* ───────────────────────── People ───────────────────────── */

/**
 * A human known to an org: performer, guardian, or both. Persists across productions.
 * userId links to a login account when the person has one (older kids, adults, guardians).
 */
export const people = pgTable(
  "people",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull().default(""),
    email: text("email"),
    phone: text("phone"),
    isMinor: boolean("is_minor").notNull().default(false),
    birthYear: integer("birth_year"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("people_org_idx").on(t.orgId), index("people_user_idx").on(t.userId)],
);

/** guardian (a person, usually with an account) is responsible for minor. */
export const guardianships = pgTable(
  "guardianships",
  {
    guardianId: uuid("guardian_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    minorId: uuid("minor_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    relationship: text("relationship").notNull().default("Parent"),
  },
  (t) => [primaryKey({ columns: [t.guardianId, t.minorId] })],
);

/* ───────────────────────── Productions ───────────────────────── */

export const productionStatus = pgEnum("production_status", [
  "planning",
  "auditions",
  "rehearsals",
  "performances",
  "closed",
]);

export const productions = pgTable("productions", {
  id: id(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  subtitle: text("subtitle"), // e.g. "Spring Musical 2027"
  description: text("description"),
  venue: text("venue"),
  defaultLocation: text("default_location"), // default rehearsal location
  status: productionStatus("status").notNull().default("planning"),
  firstRehearsal: date("first_rehearsal"),
  openingDate: date("opening_date"),
  closingDate: date("closing_date"),
  accentColor: text("accent_color").notNull().default("#7c3aed"),
  createdAt: createdAt(),
});

/** Leadership of a production: Director, Choreographer, Music Director, Stage Manager, … */
export const creativeTeam = pgTable(
  "creative_team",
  {
    productionId: uuid("production_id")
      .notNull()
      .references(() => productions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    canEdit: boolean("can_edit").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.productionId, t.userId] })],
);

export const roleKind = pgEnum("role_kind", ["lead", "supporting", "featured", "ensemble"]);

/** A character / part. Ensemble roles typically have many performers. */
export const roles = pgTable(
  "roles",
  {
    id: id(),
    productionId: uuid("production_id")
      .notNull()
      .references(() => productions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    kind: roleKind("kind").notNull().default("supporting"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("roles_production_idx").on(t.productionId)],
);

export const assignmentKind = pgEnum("assignment_kind", ["primary", "understudy", "swing"]);

/** Who plays a role. A person may hold several roles; a role may have several people. */
export const roleAssignments = pgTable(
  "role_assignments",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    kind: assignmentKind("kind").notNull().default("primary"),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.personId] })],
);

/** Named bundle of roles, e.g. "Pirates", "Dance Ensemble", "Daughters". */
export const roleGroups = pgTable("role_groups", {
  id: id(),
  productionId: uuid("production_id")
    .notNull()
    .references(() => productions.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color"),
  createdAt: createdAt(),
});

export const roleGroupMembers = pgTable(
  "role_group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => roleGroups.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.roleId] })],
);

export const scenes = pgTable(
  "scenes",
  {
    id: id(),
    productionId: uuid("production_id")
      .notNull()
      .references(() => productions.id, { onDelete: "cascade" }),
    act: integer("act").notNull().default(1),
    number: text("number").notNull(), // "1", "3A", "Prologue"
    name: text("name").notNull(),
    description: text("description"),
    songs: text("songs"), // free text, comma separated
    pages: text("pages"), // e.g. "12-18"
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("scenes_production_idx").on(t.productionId)],
);

/** Roles that appear in a scene (the scene breakdown). */
export const sceneRoles = pgTable(
  "scene_roles",
  {
    sceneId: uuid("scene_id")
      .notNull()
      .references(() => scenes.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.sceneId, t.roleId] })],
);

/* ───────────────────────── Schedule ───────────────────────── */

export const eventKind = pgEnum("event_kind", [
  "rehearsal",
  "performance",
  "tech",
  "dress",
  "fitting",
  "meeting",
  "other",
]);
export const eventStatus = pgEnum("event_status", ["draft", "published", "cancelled"]);

/** A rehearsal or a show (performance). Only published/cancelled events are visible to cast. */
export const events = pgTable(
  "events",
  {
    id: id(),
    productionId: uuid("production_id")
      .notNull()
      .references(() => productions.id, { onDelete: "cascade" }),
    kind: eventKind("kind").notNull().default("rehearsal"),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    location: text("location"),
    notes: text("notes"),
    status: eventStatus("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /** Bumped on every material change after publish; drives "Updated" badges and ICS SEQUENCE. */
    revision: integer("revision").notNull().default(0),
    /** What changed, in the creative team's words ("Moved to 6:30"), shown to families with the Updated badge. */
    changeNote: text("change_note"),
    /** When the last material change (revision bump) or cancellation happened. */
    changedAt: timestamp("changed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("events_production_start_idx").on(t.productionId, t.startsAt)],
);

/**
 * A time block within an event ("6:00–6:45 Act 1 Sc 3 w/ Choreographer").
 * Who is called is defined by blockCalls. Each person's call time for the event is the
 * start of the earliest block they're called to; release is the end of the latest one.
 */
export const eventBlocks = pgTable(
  "event_blocks",
  {
    id: id(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    title: text("title"), // optional label; defaults to scene names
    leader: text("leader"), // e.g. "Choreographer", "Music Director"
    location: text("location"), // room, if different from the event
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("event_blocks_event_idx").on(t.eventId)],
);

export const callTarget = pgEnum("call_target", ["scene", "role", "group", "person", "all_cast"]);

/** Who a block calls. targetId is null only for all_cast. */
export const blockCalls = pgTable(
  "block_calls",
  {
    id: id(),
    blockId: uuid("block_id")
      .notNull()
      .references(() => eventBlocks.id, { onDelete: "cascade" }),
    target: callTarget("target").notNull(),
    targetId: uuid("target_id"),
  },
  (t) => [index("block_calls_block_idx").on(t.blockId)],
);

/** Performer-reported unavailability. */
export const conflicts = pgTable(
  "conflicts",
  {
    id: id(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    productionId: uuid("production_id").references(() => productions.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    note: text("note"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("conflicts_person_idx").on(t.personId)],
);

/** Production-wide announcements, the structured replacement for a chat feed. */
export const announcements = pgTable("announcements", {
  id: id(),
  productionId: uuid("production_id")
    .notNull()
    .references(() => productions.id, { onDelete: "cascade" }),
  authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: createdAt(),
});

/* ───────────────────────── Auditions ───────────────────────── */

export const auditions = pgTable("auditions", {
  id: id(),
  productionId: uuid("production_id")
    .notNull()
    .references(() => productions.id, { onDelete: "cascade" }),
  slug: text("slug").notNull().unique(), // public signup at /audition/<slug>
  title: text("title").notNull(),
  description: text("description"), // requirements: prepare 16 bars, wear shoes to dance…
  location: text("location"),
  isOpen: boolean("is_open").notNull().default(true),
  /** Extra questions shown on the signup form: [{ id, label, type: "text"|"textarea"|"checkbox" }] */
  questions: jsonb("questions").$type<{ id: string; label: string; type: "text" | "textarea" | "checkbox" }[]>()
    .notNull()
    .default([]),
  createdAt: createdAt(),
});

export const slotKind = pgEnum("slot_kind", ["audition", "callback"]);

export const auditionSlots = pgTable(
  "audition_slots",
  {
    id: id(),
    auditionId: uuid("audition_id")
      .notNull()
      .references(() => auditions.id, { onDelete: "cascade" }),
    kind: slotKind("kind").notNull().default("audition"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    capacity: integer("capacity").notNull().default(1),
    label: text("label"), // e.g. "Dance call", "Pirates callback"
    location: text("location"),
  },
  (t) => [index("audition_slots_audition_idx").on(t.auditionId)],
);

export const signupStatus = pgEnum("signup_status", [
  "registered",
  "checked_in",
  "auditioned",
  "callback",
  "cast",
  "not_cast",
  "withdrawn",
]);

export const auditionSignups = pgTable(
  "audition_signups",
  {
    id: id(),
    auditionId: uuid("audition_id")
      .notNull()
      .references(() => auditions.id, { onDelete: "cascade" }),
    slotId: uuid("slot_id").references(() => auditionSlots.id, { onDelete: "set null" }),
    callbackSlotId: uuid("callback_slot_id").references(() => auditionSlots.id, { onDelete: "set null" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    age: integer("age"),
    guardianName: text("guardian_name"),
    guardianEmail: text("guardian_email"),
    guardianPhone: text("guardian_phone"),
    rolesInterested: text("roles_interested"),
    experience: text("experience"),
    conflictsText: text("conflicts_text"),
    answers: jsonb("answers").$type<Record<string, string | boolean>>().notNull().default({}),
    status: signupStatus("status").notNull().default("registered"),
    /** Roles the creative team wants to see at callbacks (role ids). */
    callbackRoleIds: jsonb("callback_role_ids").$type<string[]>().notNull().default([]),
    rating: integer("rating"), // 1-5
    staffNotes: text("staff_notes"),
    /** Set when converted to a person record on casting. */
    personId: uuid("person_id").references(() => people.id, { onDelete: "set null" }),
    /** Lets the auditioner view/manage their signup without an account: /audition/<slug>/me/<token> */
    manageToken: text("manage_token").notNull().unique(),
    createdAt: createdAt(),
    /**
     * Structured conflicts given at signup, as org-local wall-clock values:
     * [{ date: "2026-10-21", allDay, start?: "15:00", end?: "17:00", weekly?, note? }].
     * Copied into `conflicts` (with productionId) when the signup is cast.
     */
    conflictDates: jsonb("conflict_dates")
      .$type<{ date: string; allDay: boolean; start?: string; end?: string; weekly?: boolean; note?: string }[]>()
      .notNull()
      .default([]),
  },
  (t) => [index("audition_signups_audition_idx").on(t.auditionId)],
);

/* ───────────────────────── Relations ───────────────────────── */

export const usersRelations = relations(users, ({ many }) => ({
  orgMemberships: many(orgMembers),
  people: many(people),
  creativeRoles: many(creativeTeam),
}));

export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(orgMembers),
  productions: many(productions),
  people: many(people),
}));

export const orgMembersRelations = relations(orgMembers, ({ one }) => ({
  org: one(organizations, { fields: [orgMembers.orgId], references: [organizations.id] }),
  user: one(users, { fields: [orgMembers.userId], references: [users.id] }),
}));

export const peopleRelations = relations(people, ({ one, many }) => ({
  org: one(organizations, { fields: [people.orgId], references: [organizations.id] }),
  user: one(users, { fields: [people.userId], references: [users.id] }),
  assignments: many(roleAssignments),
  guardians: many(guardianships, { relationName: "minor" }),
  wards: many(guardianships, { relationName: "guardian" }),
  conflicts: many(conflicts),
}));

export const guardianshipsRelations = relations(guardianships, ({ one }) => ({
  guardian: one(people, { fields: [guardianships.guardianId], references: [people.id], relationName: "guardian" }),
  minor: one(people, { fields: [guardianships.minorId], references: [people.id], relationName: "minor" }),
}));

export const productionsRelations = relations(productions, ({ one, many }) => ({
  org: one(organizations, { fields: [productions.orgId], references: [organizations.id] }),
  creativeTeam: many(creativeTeam),
  roles: many(roles),
  scenes: many(scenes),
  events: many(events),
  groups: many(roleGroups),
  auditions: many(auditions),
  announcements: many(announcements),
}));

export const creativeTeamRelations = relations(creativeTeam, ({ one }) => ({
  production: one(productions, { fields: [creativeTeam.productionId], references: [productions.id] }),
  user: one(users, { fields: [creativeTeam.userId], references: [users.id] }),
}));

export const rolesRelations = relations(roles, ({ one, many }) => ({
  production: one(productions, { fields: [roles.productionId], references: [productions.id] }),
  assignments: many(roleAssignments),
  scenes: many(sceneRoles),
  groups: many(roleGroupMembers),
}));

export const roleAssignmentsRelations = relations(roleAssignments, ({ one }) => ({
  role: one(roles, { fields: [roleAssignments.roleId], references: [roles.id] }),
  person: one(people, { fields: [roleAssignments.personId], references: [people.id] }),
}));

export const roleGroupsRelations = relations(roleGroups, ({ one, many }) => ({
  production: one(productions, { fields: [roleGroups.productionId], references: [productions.id] }),
  members: many(roleGroupMembers),
}));

export const roleGroupMembersRelations = relations(roleGroupMembers, ({ one }) => ({
  group: one(roleGroups, { fields: [roleGroupMembers.groupId], references: [roleGroups.id] }),
  role: one(roles, { fields: [roleGroupMembers.roleId], references: [roles.id] }),
}));

export const scenesRelations = relations(scenes, ({ one, many }) => ({
  production: one(productions, { fields: [scenes.productionId], references: [productions.id] }),
  roles: many(sceneRoles),
}));

export const sceneRolesRelations = relations(sceneRoles, ({ one }) => ({
  scene: one(scenes, { fields: [sceneRoles.sceneId], references: [scenes.id] }),
  role: one(roles, { fields: [sceneRoles.roleId], references: [roles.id] }),
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
  production: one(productions, { fields: [events.productionId], references: [productions.id] }),
  blocks: many(eventBlocks),
}));

export const eventBlocksRelations = relations(eventBlocks, ({ one, many }) => ({
  event: one(events, { fields: [eventBlocks.eventId], references: [events.id] }),
  calls: many(blockCalls),
}));

export const blockCallsRelations = relations(blockCalls, ({ one }) => ({
  block: one(eventBlocks, { fields: [blockCalls.blockId], references: [eventBlocks.id] }),
}));

export const conflictsRelations = relations(conflicts, ({ one }) => ({
  person: one(people, { fields: [conflicts.personId], references: [people.id] }),
}));

export const auditionsRelations = relations(auditions, ({ one, many }) => ({
  production: one(productions, { fields: [auditions.productionId], references: [productions.id] }),
  slots: many(auditionSlots),
  signups: many(auditionSignups),
}));

export const auditionSlotsRelations = relations(auditionSlots, ({ one }) => ({
  audition: one(auditions, { fields: [auditionSlots.auditionId], references: [auditions.id] }),
}));

export const auditionSignupsRelations = relations(auditionSignups, ({ one }) => ({
  audition: one(auditions, { fields: [auditionSignups.auditionId], references: [auditions.id] }),
  slot: one(auditionSlots, { fields: [auditionSignups.slotId], references: [auditionSlots.id] }),
}));

export const announcementsRelations = relations(announcements, ({ one }) => ({
  production: one(productions, { fields: [announcements.productionId], references: [productions.id] }),
}));

/* ───────────────────────── Resources ───────────────────────── */

/**
 * Links (no uploads) to rehearsal materials: script pages, vocal tracks, choreo videos, docs.
 * Optionally attached to a scene and/or a role; with neither, it's production-wide.
 * kind: "script" | "track" | "video" | "doc" | "link".
 */
export const resources = pgTable(
  "resources",
  {
    id: id(),
    productionId: uuid("production_id")
      .notNull()
      .references(() => productions.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    url: text("url").notNull(),
    kind: text("kind").notNull().default("link"),
    sceneId: uuid("scene_id").references(() => scenes.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").references(() => roles.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("resources_production_idx").on(t.productionId)],
);

/* ───────────────────────── Volunteers ───────────────────────── */

/**
 * A parent/crew volunteer job for a production: "Concessions — Opening Night", "Costume crew",
 * "Snack table". startsAt/endsAt are null for ongoing roles (crew that works across the run).
 */
export const volunteerShifts = pgTable(
  "volunteer_shifts",
  {
    id: id(),
    productionId: uuid("production_id")
      .notNull()
      .references(() => productions.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    location: text("location"),
    capacity: integer("capacity").notNull().default(1),
    /** Volunteer-hour credit, in minutes. Null = use the shift's duration (0 for ongoing roles). */
    creditMinutes: integer("credit_minutes"),
    createdAt: createdAt(),
  },
  (t) => [index("volunteer_shifts_production_idx").on(t.productionId)],
);

/** One account signed up for one shift (a family; personId optionally says on whose behalf). */
export const volunteerSignups = pgTable(
  "volunteer_signups",
  {
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => volunteerShifts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    personId: uuid("person_id").references(() => people.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.shiftId, t.userId] }), index("volunteer_signups_user_idx").on(t.userId)],
);

/** Per-production volunteer settings (row is optional). */
export const volunteerSettings = pgTable("volunteer_settings", {
  productionId: uuid("production_id")
    .primaryKey()
    .references(() => productions.id, { onDelete: "cascade" }),
  /** Hours each family is asked to volunteer for this production. Null = no requirement. */
  requiredHours: integer("required_hours"),
});

/* ───────────────────────── Change log ───────────────────────── */

/**
 * One row per material change to an already-published event (one per revision bump).
 * `summary` is human-readable ("Start moved 6:00 → 5:30 PM; Act 2 Sc 3 added") for badges and digests.
 */
export const eventChanges = pgTable(
  "event_changes",
  {
    id: id(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    productionId: uuid("production_id")
      .notNull()
      .references(() => productions.id, { onDelete: "cascade" }),
    /** The event's revision after this change. */
    revision: integer("revision").notNull(),
    summary: text("summary").notNull(),
    changedByUserId: uuid("changed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("event_changes_event_idx").on(t.eventId, t.revision),
    index("event_changes_production_idx").on(t.productionId, t.createdAt),
  ],
);

/** "Got it": the highest revision of an event this account has acknowledged. */
export const changeAcks = pgTable(
  "change_acks",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    ackedAt: timestamp("acked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.eventId] }), index("change_acks_event_idx").on(t.eventId)],
);
