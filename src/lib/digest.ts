import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { organizations, users } from "@/db/schema";
import { getCoveredPersonIds } from "./access";
import { getCallsForPeople } from "./calls";
import { getChangesForUser } from "./changes";
import { dayKey, fmtDayLong, fmtRange } from "./time";

/**
 * "This week's changes" digest for one account: what changed in the schedule recently (for
 * events that call anyone they cover) and their calls for the coming week.
 *
 * buildDigest() → data, renderDigestHtml()/renderDigestText() → email bodies, sendDigest() →
 * delivers through Resend when RESEND_API_KEY + RESEND_FROM are set (no SDK; plain fetch), else
 * reports `skipped`. A scheduler (cron route) can loop over users and call sendDigest.
 */

export type Digest = {
  user: { id: string; name: string; email: string };
  periodStart: Date;
  periodEnd: Date;
  tz: string;
  changes: {
    eventId: string;
    production: string;
    eventTitle: string;
    when: string; // "Tuesday, October 7 · 6:00–9:00 PM"
    people: string[];
    summaries: string[];
    acknowledged: boolean;
    cancelled: boolean;
  }[];
  upcoming: {
    day: string; // "Tuesday, October 7"
    items: { person: string; production: string; eventTitle: string; called: string; location: string | null; cancelled: boolean; reasons: string[] }[];
  }[];
  multiPerson: boolean;
};

export async function buildDigest(userId: string, opts: { days?: number; now?: Date } = {}): Promise<Digest | null> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return null;
  const now = opts.now ?? new Date();
  const days = opts.days ?? 7;
  const periodStart = new Date(now.getTime() - days * 86400_000);
  const periodEnd = new Date(now.getTime() + days * 86400_000);

  const covered = await getCoveredPersonIds(user.id);
  // "Coming up" = the next `days` days of calls.
  const calls = covered.length ? await getCallsForPeople(covered, { from: now, to: periodEnd }) : [];
  // Changes made in the last `days` days that affected someone this user covers — to any event
  // that hasn't happened yet, however far out — with that person's own summary.
  const familyChanges = await getChangesForUser(user.id, { createdSince: periodStart, eventsEndingAfter: now, includeAcknowledged: true });
  const orgIds = [...new Set([...calls.map((c) => c.production.orgId), ...familyChanges.map((c) => c.production.orgId)])];
  const orgRows = orgIds.length ? await db.select().from(organizations).where(inArray(organizations.id, orgIds)) : [];
  const tz = orgRows[0]?.timezone ?? "America/New_York";
  const tzOf = (orgId: string) => orgRows.find((o) => o.id === orgId)?.timezone ?? tz;
  // First names (all FamilyChange carries); siblings with the same first name are an accepted edge case.
  const multiPerson = new Set([...calls.map((c) => c.person.firstName), ...familyChanges.flatMap((c) => c.people)]).size > 1;

  const changes: Digest["changes"] = familyChanges.map((fc) => {
    const z = tzOf(fc.production.orgId);
    return {
      eventId: fc.event.id,
      production: fc.production.title,
      eventTitle: fc.event.title,
      when: `${fmtDayLong(fc.event.startsAt, z)} · ${fmtRange(fc.event.startsAt, fc.event.endsAt, z)}`,
      people: fc.people,
      summaries: fc.changes.flatMap((c) => c.lines),
      acknowledged: fc.acknowledged,
      cancelled: fc.event.status === "cancelled",
    };
  });

  const upcomingCalls = calls.filter((c) => c.releaseAt >= now && c.callAt <= periodEnd);
  const byDay = new Map<string, Digest["upcoming"][number]>();
  for (const c of upcomingCalls) {
    const z = tzOf(c.production.orgId);
    const k = dayKey(c.callAt, z);
    const day = byDay.get(k) ?? { day: fmtDayLong(c.callAt, z), items: [] };
    day.items.push({
      person: c.person.firstName,
      production: c.production.title,
      eventTitle: c.event.title,
      called: fmtRange(c.callAt, c.releaseAt, z),
      location: c.event.location,
      cancelled: c.event.status === "cancelled",
      reasons: c.reasons,
    });
    byDay.set(k, day);
  }

  return {
    user: { id: user.id, name: user.name, email: user.email },
    periodStart,
    periodEnd,
    tz,
    changes,
    upcoming: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v),
    multiPerson,
  };
}

export function digestSubject(d: Digest) {
  const n = d.changes.filter((c) => !c.acknowledged).length;
  return n ? `Schedule changes: ${n} rehearsal${n === 1 ? "" : "s"} updated` : "Your calls this week";
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Email-safe HTML (tables + inline styles, no external CSS). */
export function renderDigestHtml(d: Digest, appUrl: string): string {
  const who = (names: string[]) => (d.multiPerson && names.length ? `<strong>${esc(names.join(" & "))}</strong> · ` : "");
  const changeRows = d.changes
    .map(
      (c) => `<tr><td style="padding:12px 16px;border-bottom:1px solid #eee;">
  <div style="font-size:13px;color:${c.cancelled ? "#b42318" : "#6b7280"};">${c.cancelled ? "CANCELLED · " : ""}${who(c.people)}${esc(c.when)}</div>
  <div style="font-size:16px;font-weight:600;margin:2px 0;">${esc(c.production)} — ${esc(c.eventTitle)}</div>
  <ul style="margin:6px 0 0 18px;padding:0;font-size:15px;color:#111827;">${c.summaries.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
  ${c.acknowledged ? `<div style="font-size:12px;color:#6b7280;margin-top:4px;">You've already seen this.</div>` : ""}
</td></tr>`,
    )
    .join("");
  const upcomingRows = d.upcoming
    .map(
      (day) => `<tr><td style="padding:12px 16px 4px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;">${esc(day.day)}</td></tr>
${day.items
  .map(
    (i) => `<tr><td style="padding:4px 16px 10px;font-size:15px;${i.cancelled ? "text-decoration:line-through;color:#9ca3af;" : ""}">
  ${d.multiPerson ? `<strong>${esc(i.person)}</strong> · ` : ""}Called <strong>${esc(i.called)}</strong> · ${esc(i.production)} ${esc(i.eventTitle)}${i.location ? ` · ${esc(i.location)}` : ""}${i.cancelled ? " (cancelled)" : ""}
  ${i.reasons.length ? `<div style="font-size:13px;color:#6b7280;">${esc(i.reasons.join(", "))}</div>` : ""}
</td></tr>`,
  )
  .join("")}`,
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(digestSubject(d))}</title></head>
<body style="margin:0;background:#f6f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;">
<tr><td style="padding:20px 16px 8px;"><div style="font-size:13px;color:#6b7280;">Calltime</div>
<div style="font-size:22px;font-weight:700;margin-top:4px;">Hi ${esc(d.user.name.split(" ")[0])} — this week's changes</div></td></tr>
${
  d.changes.length
    ? changeRows
    : `<tr><td style="padding:8px 16px 12px;font-size:15px;color:#374151;">No schedule changes this week.</td></tr>`
}
<tr><td style="padding:16px 16px 0;font-size:18px;font-weight:700;">Coming up</td></tr>
${upcomingRows || `<tr><td style="padding:8px 16px;font-size:15px;color:#374151;">No calls in the next 7 days.</td></tr>`}
<tr><td style="padding:16px;"><a href="${esc(appUrl)}/home" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 18px;border-radius:12px;">Open My Calls</a></td></tr>
<tr><td style="padding:0 16px 20px;font-size:12px;color:#6b7280;">Times are ${esc(d.tz.replaceAll("_", " "))}. Subscribed to your calendar? It updates on its own.</td></tr>
</table></td></tr></table></body></html>`;
}

export function renderDigestText(d: Digest, appUrl: string): string {
  const lines = [`Hi ${d.user.name.split(" ")[0]} — this week's changes`, ""];
  if (d.changes.length === 0) lines.push("No schedule changes this week.");
  for (const c of d.changes) {
    lines.push(`${c.cancelled ? "CANCELLED: " : ""}${d.multiPerson ? `${c.people.join(" & ")}: ` : ""}${c.production} — ${c.eventTitle}`);
    lines.push(`  ${c.when}`);
    for (const s of c.summaries) lines.push(`  - ${s}`);
    lines.push("");
  }
  lines.push("", "Coming up");
  if (d.upcoming.length === 0) lines.push("No calls in the next 7 days.");
  for (const day of d.upcoming) {
    lines.push("", day.day);
    for (const i of day.items)
      lines.push(
        `  ${d.multiPerson ? `${i.person}: ` : ""}Called ${i.called} · ${i.production} ${i.eventTitle}${i.location ? ` · ${i.location}` : ""}${i.cancelled ? " (CANCELLED)" : ""}`,
      );
  }
  lines.push("", `${appUrl}/home`);
  return lines.join("\n");
}

/** Deliver via Resend if configured. Never throws for "not configured". */
/**
 * `idempotencyKey` (e.g. `digest-<userId>-<yyyy-ww>`) makes a retried cron run send at most once;
 * Resend dedupes on it for 24h.
 */
export async function sendDigest(userId: string, appUrl: string, opts: { idempotencyKey?: string } = {}) {
  const d = await buildDigest(userId);
  if (!d) return { ok: false as const, reason: "no such user" };
  if (d.changes.length === 0 && d.upcoming.length === 0) return { ok: false as const, reason: "nothing to send" };
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM; // e.g. "Calltime <schedule@yourdomain.org>" (verified in Resend)
  if (!apiKey || !from) return { ok: false as const, reason: "skipped: RESEND_API_KEY / RESEND_FROM not set" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from,
      to: [d.user.email],
      subject: digestSubject(d),
      html: renderDigestHtml(d, appUrl),
      text: renderDigestText(d, appUrl),
    }),
  });
  if (!res.ok) return { ok: false as const, reason: `resend ${res.status}: ${await res.text()}` };
  return { ok: true as const, id: ((await res.json()) as { id?: string }).id };
}
