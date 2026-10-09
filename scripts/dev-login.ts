/**
 * Prints a session cookie for a seeded user so agents/scripts can hit authed pages:
 *   npm run -s dev-login -- director@riverside.dev
 *   curl -b "$(npm run -s dev-login -- director@riverside.dev)" http://localhost:3100/home
 */
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { sessions, users } from "../src/db/schema";

async function main() {
  const email = (process.argv[2] ?? "director@riverside.dev").toLowerCase();
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user) throw new Error(`No user ${email}`);
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({
    id: createHash("sha256").update(token).digest("hex"),
    userId: user.id,
    expiresAt: new Date(Date.now() + 7 * 86400_000),
  });
  console.log(`ct_session=${token}`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
