import 'dotenv/config';
import { Pool } from "pg";
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is required');
}

function getPositiveInteger(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function requiresChannelBinding(connectionString: string): boolean {
  try {
    return new URL(connectionString).searchParams.get('channel_binding') === 'require';
  } catch {
    return false;
  }
}

function getConnectionConfig(connectionString: string): {
  connectionString: string;
  ssl?: { rejectUnauthorized: true };
} {
  const url = new URL(connectionString);
  const sslMode = url.searchParams.get('sslmode')?.toLowerCase();
  const isNeon = url.hostname.endsWith('.neon.tech');
  const requiresTls = isNeon || (sslMode !== undefined && sslMode !== 'disable');

  if (!requiresTls) return { connectionString };

  // node-postgres reparses connectionString after applying Pool options. Remove
  // URL SSL settings so they cannot replace this explicitly verified TLS config.
  url.searchParams.delete('sslmode');
  url.searchParams.delete('ssl');
  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true },
  };
}

const connectionConfig = getConnectionConfig(databaseUrl);

// Neon pooled connections are shared by the API and worker, so keep the
// per-process default conservative and allow deployments to tune it explicitly.
const pool = new Pool({
  ...connectionConfig,
  max: getPositiveInteger('PG_POOL_MAX', 5),
  idleTimeoutMillis: 30000, // close idle connections after 30s
  connectionTimeoutMillis: getPositiveInteger('PG_CONNECTION_TIMEOUT_MS', 10000),
  // node-postgres does not map channel_binding in a connection string to this
  // option. Enable SCRAM channel binding when the supplied Neon URL requires it.
  enableChannelBinding: requiresChannelBinding(databaseUrl),
});
// The pool creates clients lazily; this fires each time a new pooled client is opened.
pool.on("connect", () => {
  console.log("Postgres pool opened a new client connection");
});
pool.on("error", (err) => {
  console.error("Unexpected idle Postgres pool error; the pool will reconnect:", err);
});
export const db = pool;
// Helper: run a query with automatic error logging
export async function query<T = any>(
  text: string,
  params?: any[],
): Promise<T[]> {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      // Log slow queries — useful for identifying missing indexes
      console.warn("Slow query detected:", { text, duration });
    }
    return result.rows;
  } catch (err) {
    console.error("Query error:", { text, params, err });
    throw err;
  }
}
