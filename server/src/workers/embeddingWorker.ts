import { Redis } from "ioredis";
import { query } from "../db";
import { getBatchEmbeddings } from "../services/embedding";
const redis = new Redis(process.env.REDIS_URL!);
const BATCH_SIZE = 100; // embed 100 logs at a time
const WORKER_INTERVAL = 5000; // run every 5 seconds
export async function processEmbeddings(): Promise<void> {
  try {
    // Grab up to BATCH_SIZE items from the embedding queue
    const items: Array<{ log_id: number; message: string }> = [];

    for (let i = 0; i < BATCH_SIZE; i++) {
      const raw = await redis.lpop("embedding_queue");
      if (!raw) break;
      items.push(JSON.parse(raw));
    }
    if (items.length === 0) return;
    // Get embeddings in one API call (batch is more efficient)
    const messages = items.map((item) => item.message);
    const embeddings = await getBatchEmbeddings(messages);
    // Update each log with its embedding
    // pgvector accepts vectors as '[0.1, 0.2, ...]' strings
    for (let i = 0; i < items.length; i++) {
      const vectorStr = `[${embeddings[i].join(",")}]`;
      await query(`UPDATE logs SET embedding = $1 WHERE id = $2`, [
        vectorStr,
        items[i].log_id,
      ]);
    }
    console.log(`Embedded ${items.length} logs`);
  } catch (err) {
    console.error("Embedding worker error:", err);
    // Items already popped from queue are lost on error
    // Production: use BRPOPLPUSH for reliable queue (move to processing queue, push back on failure)
  }
}
export function startEmbeddingWorker(): void {
  console.log("Embedding worker started");
  setInterval(processEmbeddings, WORKER_INTERVAL);
}
