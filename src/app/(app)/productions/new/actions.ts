"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { productions } from "@/db/schema";
import { getUserOrgs } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { ActionError, formAction, parseForm, type FormState } from "@/lib/production-queries";
import { productionSchema } from "../_components/production-schema";

export async function createProduction(_: FormState, fd: FormData): Promise<FormState> {
  let newId = "";
  const res = await formAction(async () => {
    const user = await requireUser();
    const orgs = await getUserOrgs(user);
    const adminOrgs = orgs.filter((o) => o.role === "admin");
    if (adminOrgs.length === 0) throw new ActionError("Only company admins can create productions.");
    const { orgId } = parseForm(z.object({ orgId: z.string().optional() }), fd);
    const org = orgId ? adminOrgs.find((o) => o.org.id === orgId) : adminOrgs.length === 1 ? adminOrgs[0] : undefined;
    if (!org) throw new ActionError("Choose a company.");
    const data = parseForm(productionSchema, fd);
    const [row] = await db
      .insert(productions)
      .values({ ...data, orgId: org.org.id })
      .returning({ id: productions.id });
    newId = row.id;
  });
  if (newId) redirect(`/p/${newId}`);
  return res;
}
