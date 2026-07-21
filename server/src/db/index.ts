import 'dotenv/config';
import { Pool } from "pg";
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}
// Connection pool: reuses connections instead of creating a new one per query
// Max 20 connections is a safe default; tune based on your Postgres max_connections
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000, // close idle connections after 30s
  connectionTimeoutMillis: 2000, // fail fast if we can't get a connection
});
// Test the connection on startup
pool.on("connect", () => {
  console.log("Connected to Postgres");
});
pool.on("error", (err) => {
  console.error("Unexpected Postgres error:", err);
  process.exit(1);
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
