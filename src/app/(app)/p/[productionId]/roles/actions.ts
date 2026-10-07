"use server";

import { and, asc, eq, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { roleGroupMembers, roleGroups, roles } from "@/db/schema";
import { requireProductionEditor } from "@/lib/access";
import {
  assertRolesInProduction,
  deleteCallsTargeting,
  formAction,
  getGroupInProduction,
  getRoleInProduction,
  impactNote,
  mutateCalls,
  parseForm,
  renumber,
  type FormState,
} from "@/lib/production-queries";

const roleSchema = z.object({
  name: z.string().trim().min(1, "Required").max(120),
  kind: z.enum(["lead", "supporting", "featured", "ensemble"]),
  description: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v ? v : null)),
});

const idList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]));

const groupSchema = z.object({
  name: z.string().trim().min(1, "Required").max(120),
  color: z
    .string()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^#[0-9a-fA-F]{6}$/.test(v), "Pick a color"),
  roleIds: idList,
});

function revalidate(productionId: string) {
  revalidatePath(`/p/${productionId}`, "layout");
}

export async function createRole(productionId: string, _: FormState, fd: FormData): Promise<FormState> {
  return formAction(async () => {
    await requireProductionEditor(productionId);
    const data = parseForm(roleSchema, fd);
    const [{ m }] = await db.select({ m: max(roles.sortOrder) }).from(roles).where(eq(roles.productionId, productionId));
    await db.insert(roles).values({ ...data, productionId, sortOrder: (m ?? 0) + 1 });
    revalidate(productionId);
    return { message: `Added ${data.name}.` };
  });
}

export async function updateRole(productionId: string, roleId: string, _: FormState, fd: FormData): Promise<FormState> {
  return formAction(async () => {
    await requireProductionEditor(productionId);
    await getRoleInProduction(productionId, roleId);
    const data = parseForm(roleSchema, fd);
    await db.update(roles).set(data).where(eq(roles.id, roleId));
    revalidate(productionId);
    return { message: "Saved." };
  });
}

export async function deleteRole(productionId: string, roleId: string) {
  const { user } = await requireProductionEditor(productionId);
  await getRoleInProduction(productionId, roleId);
  await mutateCalls(productionId, user.id, async (tx) => {
    await tx.delete(roles).where(and(eq(roles.id, roleId), eq(roles.productionId, productionId)));
    await deleteCallsTargeting("role", roleId, tx);
  }, { roles: [roleId] });
  revalidate(productionId);
  redirect(`/p/${productionId}/roles`);
}

/** Swap with the neighbor of the same kind, then renumber sortOrder for the whole production. */
export async function moveRole(productionId: string, roleId: string, dir: "up" | "down") {
  await requireProductionEditor(productionId);
  await getRoleInProduction(productionId, roleId);
  const rows = await db
    .select({ id: roles.id, kind: roles.kind })
    .from(roles)
    .where(eq(roles.productionId, productionId))
    .orderBy(asc(roles.sortOrder), asc(roles.name));
  const i = rows.findIndex((r) => r.id === roleId);
  if (i < 0) return;
  const step = dir === "up" ? -1 : 1;
  let j = i + step;
  while (j >= 0 && j < rows.length && rows[j].kind !== rows[i].kind) j += step;
  if (j < 0 || j >= rows.length) return;
  [rows[i], rows[j]] = [rows[j], rows[i]];
  await renumber(roles, rows.map((r) => r.id));
  revalidate(productionId);
}

export async function createGroup(productionId: string, _: FormState, fd: FormData): Promise<FormState> {
  return formAction(async () => {
    await requireProductionEditor(productionId);
    const { roleIds, ...data } = parseForm(groupSchema, fd);
    const ids = await assertRolesInProduction(productionId, roleIds);
    const [g] = await db.insert(roleGroups).values({ ...data, productionId }).returning({ id: roleGroups.id });
    if (ids.length) await db.insert(roleGroupMembers).values(ids.map((roleId) => ({ groupId: g.id, roleId })));
    revalidate(productionId);
    return { message: `Created ${data.name}.` };
  });
}

export async function updateGroup(productionId: string, groupId: string, _: FormState, fd: FormData): Promise<FormState> {
  return formAction(async () => {
    const { user } = await requireProductionEditor(productionId);
    await getGroupInProduction(productionId, groupId);
    const { roleIds, ...data } = parseForm(groupSchema, fd);
    const ids = await assertRolesInProduction(productionId, roleIds);
    // Name/color are labels; membership decides who a group call reaches.
    await db.update(roleGroups).set(data).where(eq(roleGroups.id, groupId));
    const { affected } = await mutateCalls(productionId, user.id, async (tx) => {
      await tx.delete(roleGroupMembers).where(eq(roleGroupMembers.groupId, groupId));
      if (ids.length) await tx.insert(roleGroupMembers).values(ids.map((roleId) => ({ groupId, roleId })));
    }, { groups: [groupId] });
    revalidate(productionId);
    return { message: `Saved.${impactNote(affected)}` };
  });
}

export async function deleteGroup(productionId: string, groupId: string) {
  const { user } = await requireProductionEditor(productionId);
  await getGroupInProduction(productionId, groupId);
  await mutateCalls(productionId, user.id, async (tx) => {
    await tx.delete(roleGroups).where(and(eq(roleGroups.id, groupId), eq(roleGroups.productionId, productionId)));
    await deleteCallsTargeting("group", groupId, tx);
  }, { groups: [groupId] });
  revalidate(productionId);
  redirect(`/p/${productionId}/roles`);
}
