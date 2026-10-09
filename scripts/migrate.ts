/**
 * Apply pending SQL migrations from ./drizzle (generated with `npm run db:generate`).
 *
 * Runs before `next build` (see package.json "build"), so a deploy and its schema always match.
 * Databases created with the old `drizzle-kit push` flow have every table but no migration history:
 * the first run records the baseline migration as already applied instead of re-creating tables.
 *
 *   npm run db:migrate            # local (.env.local) or CI with DATABASE_URL set
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import ws from "ws";

// Only fall back to .env.local when no database is set in the environment. Otherwise a caller that
// exports just DATABASE_URL (e.g. the dev k3s DB) would get DATABASE_URL_UNPOOLED from .env.local,
// which points at production, and migrate the wrong database.
const fromEnv = !!process.env.DATABASE_URL;
if (!fromEnv) config({ path: ".env.local" });
neonConfig.webSocketConstructor = ws;

const folder = join(process.cwd(), "drizzle");
// With .env.local skipped, DATABASE_URL_UNPOOLED can only come from the same environment.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.error("db:migrate: DATABASE_URL is not set.");
  process.exit(1);
}
const host = (() => {
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable URL)";
  }
})();
console.log(`db:migrate: target ${host} (from ${fromEnv ? "environment" : ".env.local"})`);

type Journal = { entries: { idx: number; when: number; tag: string }[] };

async function main() {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);
  try {
    const journal = JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")) as Journal;
    const baseline = journal.entries[0];

    const [{ has_users }] = (await db.execute(sql`select to_regclass('public.users') is not null as has_users`)).rows as { has_users: boolean }[];
    const [{ has_log }] = (await db.execute(sql`select to_regclass('drizzle.__drizzle_migrations') is not null as has_log`)).rows as { has_log: boolean }[];
    let applied = 0;
    if (has_log) {
      const [{ n }] = (await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`)).rows as { n: number }[];
      applied = n;
    }

    if (has_users && applied === 0 && baseline) {
      // Pre-existing database (created with drizzle-kit push): record the baseline as applied.
      const file = readFileSync(join(folder, `${baseline.tag}.sql`), "utf8");
      const hash = createHash("sha256").update(file).digest("hex");
      await db.execute(sql`create schema if not exists drizzle`);
      await db.execute(
        sql`create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`,
      );
      await db.execute(sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${hash}, ${baseline.when})`);
      console.log(`db:migrate: existing database — recorded ${baseline.tag} as the baseline.`);
    }

    await migrate(db, { migrationsFolder: folder });
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`)).rows as { n: number }[];
    console.log(`db:migrate: up to date (${n} of ${journal.entries.length} migrations applied).`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("db:migrate failed:", e);
  process.exit(1);
});
