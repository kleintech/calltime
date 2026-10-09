"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { organizations, users } from "@/db/schema";
import { normalizeEmail, requirePlatformAdmin } from "@/lib/auth";
import { COMMON_TIMEZONES } from "@/lib/time";
import { firstIssue, type FormState } from "../org/_components/form-state";
import { grantOrgRoleByEmail } from "../org/_lib/members";
import { slugify } from "./_lib/slug";

const timezone = z.string().refine((tz) => COMMON_TIMEZONES.includes(tz), "Pick a timezone from the list.");

async function uniqueSlug(base: string) {
  const taken = new Set(
    (
      await db
        .select({ slug: organizations.slug })
        .from(organizations)
        .where(sql`${organizations.slug} = ${base} or ${organizations.slug} like ${base + "-%"}`)
    ).map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

const createSchema = z.object({
  name: z.string().trim().min(2, "Enter the company's name.").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(48)
    .regex(/^[a-z0-9-]*$/, "Short name can only use letters, numbers and dashes."),
  timezone,
  adminEmail: z.email("Enter the first admin's email."),
  adminName: z.string().trim().max(120),
});

/** Create a tenant + its first admin (existing account → admin now; otherwise an invite link). */
export async function createOrg(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePlatformAdmin();
  const parsed = createSchema.safeParse({
    name: fd.get("name") ?? "",
    slug: fd.get("slug") ?? "",
    timezone: fd.get("timezone") ?? "",
    adminEmail: normalizeEmail(String(fd.get("adminEmail") ?? "")),
    adminName: fd.get("adminName") ?? "",
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const d = parsed.data;
  const slug = await uniqueSlug(d.slug ? slugify(d.slug) : slugify(d.name));
  const [org] = await db.insert(organizations).values({ name: d.name, slug, timezone: d.timezone }).returning();
  await grantOrgRoleByEmail({
    orgId: org.id,
    email: d.adminEmail,
    name: d.adminName || undefined,
    role: "admin",
    invitedByUserId: me.id,
  });
  revalidatePath("/admin");
  redirect(`/admin/${org.id}?created=1`);
}

export async function updateOrg(_: FormState, fd: FormData): Promise<FormState> {
  await requirePlatformAdmin();
  const parsed = z
    .object({ orgId: z.uuid(), name: z.string().trim().min(2, "Enter a name.").max(120), timezone })
    .safeParse({ orgId: fd.get("orgId"), name: fd.get("name"), timezone: fd.get("timezone") });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  await db
    .update(organizations)
    .set({ name: parsed.data.name, timezone: parsed.data.timezone })
    .where(eq(organizations.id, parsed.data.orgId));
  revalidatePath("/admin", "layout");
  revalidatePath("/org", "layout");
  return { ok: "Saved." };
}

/** Add (or promote) an org admin by email. */
export async function addOrgAdmin(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePlatformAdmin();
  const parsed = z
    .object({ orgId: z.uuid(), email: z.email("Enter a valid email."), name: z.string().trim().max(120) })
    .safeParse({ orgId: fd.get("orgId"), email: normalizeEmail(String(fd.get("email") ?? "")), name: fd.get("name") ?? "" });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, parsed.data.orgId) });
  if (!org) return { error: "Company not found." };
  const result = await grantOrgRoleByEmail({
    orgId: org.id,
    email: parsed.data.email,
    name: parsed.data.name || undefined,
    role: "admin",
    invitedByUserId: me.id,
  });
  revalidatePath(`/admin/${org.id}`);
  revalidatePath("/admin");
  return result;
}

export async function setPlatformAdmin(fd: FormData) {
  const me = await requirePlatformAdmin();
  const { userId, value } = z
    .object({ userId: z.uuid(), value: z.enum(["true", "false"]) })
    .parse({ userId: fd.get("userId"), value: fd.get("value") });
  if (userId === me.id && value === "false") return; // don't lock yourself out
  await db.update(users).set({ isPlatformAdmin: value === "true" }).where(eq(users.id, userId));
  revalidatePath("/admin", "layout");
}
