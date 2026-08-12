import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Pool sizing: max × (number of concurrent autoscale instances) must stay under
// Postgres's max_connections limit. This is a deployment-sizing decision — tune
// DB_POOL_MAX per-instance rather than changing the code default.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX, 10) : 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// node-postgres emits 'error' on idle clients (e.g. the server closes the
// connection while it sits in the pool).  Without a listener, Node's default
// behaviour is to throw an uncaught exception and crash the process.
pool.on("error", (err) => {
  console.error("[db] Unexpected error on idle Postgres client", err);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
