import { Redis } from "ioredis";
import { db } from "../db";
const redis = new Redis(process.env.REDIS_URL!);
const BATCH_SIZE = 5000; // max logs per flush cycle
const FLUSH_INTERVAL_MS = 2000; // run every 2 seconds
export async function flushLogs(): Promise<void> {
  try {
    // LRANGE gets elements from the Redis list without deleting them
    // We delete with LTRIM after a successful insert
    const rawLogs = await redis.lrange("log_buffer", 0, BATCH_SIZE - 1);

    if (rawLogs.length === 0) return; // nothing to flush
    const logs = rawLogs.map((raw) => JSON.parse(raw));
    // Build a bulk INSERT
    // Instead of N separate inserts, one query with N rows
    // VALUES ($1,$2,$3,...), ($4,$5,$6,...), ...
    const valuePlaceholders: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
    for (const log of logs) {
      valuePlaceholders.push(
        `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++},
$${paramIndex++}, $${paramIndex++})`,
      );
      values.push(
        log.project_id,
        log.level,
        log.message,
        log.service,
        log.timestamp,
        JSON.stringify(log.metadata),
      );
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      // Bulk insert
      const insertResult = await client.query(
        `INSERT INTO logs (project_id, level, message, service, timestamp, metadata)
 VALUES ${valuePlaceholders.join(", ")}
 RETURNING id, message`,
        values,
      );
      // Only delete from Redis AFTER successful DB insert
      // If DB fails, logs stay in Redis and will be retried next cycle
      await redis.ltrim("log_buffer", rawLogs.length, -1);
      await client.query("COMMIT");
      // Push log IDs to the embedding queue so the embedding worker can process them
      const embeddingPipeline = redis.pipeline();
      for (const row of insertResult.rows) {
        embeddingPipeline.rpush(
          "embedding_queue",
          JSON.stringify({
            log_id: row.id,
            message: row.message,
          }),
        );
      }
      await embeddingPipeline.exec();
      console.log(`Flushed ${logs.length} logs to Postgres`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Flush worker error:", err);
  }
}
// Run continuously
export function startFlushWorker(): void {
  console.log("Flush worker started");
  setInterval(flushLogs, FLUSH_INTERVAL_MS);
}
