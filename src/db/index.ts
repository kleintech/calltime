import { Pool, neonConfig, type PoolClient } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

neonConfig.webSocketConstructor = ws;

const globalForDb = globalThis as unknown as { pool?: Pool };

function createPool() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  /*
   * Guard against a client going back to the pool mid-transaction. If that happens, every later
   * query that borrows it runs inside the open transaction and is silently lost. Track BEGIN/COMMIT
   * per client and, on release, roll back and log where the transaction was opened.
   */
  pool.on("connect", (client: PoolClient) => {
    const c = client as PoolClient & { __txOpenedAt?: string; __patched?: boolean };
    if (c.__patched) return;
    c.__patched = true;
    const origQuery = c.query.bind(c) as (...args: unknown[]) => unknown;
    (c as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
      const first = args[0];
      const text = (typeof first === "string" ? first : (first as { text?: string })?.text ?? "").trim().toLowerCase();
      if (text.startsWith("begin")) c.__txOpenedAt = new Error("transaction opened here").stack;
      else if (text.startsWith("commit") || text.startsWith("rollback") || text.startsWith("end")) c.__txOpenedAt = undefined;
      return origQuery(...args);
    };
  });
  // pg-pool assigns client.release per checkout, so hook the pool's internal release instead.
  const internal = pool as unknown as { _release: (client: unknown, idle: unknown, err?: unknown) => void };
  const origRelease = internal._release.bind(pool);
  internal._release = (client, idle, err) => {
    const c = client as { __txOpenedAt?: string };
    if (c.__txOpenedAt && !err) {
      console.error("[db] client released with an open transaction; discarding it.", c.__txOpenedAt);
      c.__txOpenedAt = undefined;
      // Passing an error makes the pool destroy the client instead of reusing it.
      return origRelease(client, idle, new Error("released mid-transaction"));
    }
    return origRelease(client, idle, err);
  };
  return pool;
}

const pool = globalForDb.pool ?? createPool();
if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle(pool, { schema });
export type DB = typeof db;
export { schema };
