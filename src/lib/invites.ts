import "server-only";
import { headers } from "next/headers";
import { db } from "@/db";
import { invites } from "@/db/schema";
import { normalizeEmail, randomToken } from "./auth";

/**
 * Invitations are shareable links (/invite/<token>). There's no email provider yet, so the UI
 * shows the link with copy/share buttons; whoever creates an invite sends it however they like
 * (text, email, the old group chat).
 */
export type InviteGrant = {
  orgId: string;
  email: string;
  name?: string | null;
  orgRole?: "admin" | "member";
  productionId?: string | null;
  creativeTitle?: string | null; // joins creative team of productionId with this title
  personId?: string | null; // account becomes this person
  guardianOfPersonId?: string | null; // account becomes guardian of this person
  invitedByUserId?: string | null;
};

export async function createInvite(grant: InviteGrant) {
  const token = randomToken(18);
  const [row] = await db
    .insert(invites)
    .values({
      token,
      orgId: grant.orgId,
      email: normalizeEmail(grant.email),
      name: grant.name ?? null,
      orgRole: grant.orgRole ?? "member",
      productionId: grant.productionId ?? null,
      creativeTitle: grant.creativeTitle ?? null,
      personId: grant.personId ?? null,
      guardianOfPersonId: grant.guardianOfPersonId ?? null,
      invitedByUserId: grant.invitedByUserId ?? null,
      expiresAt: new Date(Date.now() + 30 * 86400_000),
    })
    .returning();
  return { invite: row, url: await inviteUrl(token) };
}

/** Absolute base URL of the current request (works behind Vercel / LAN). */
export async function appBaseUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || /^\d/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

export async function inviteUrl(token: string) {
  return `${await appBaseUrl()}/invite/${token}`;
}
