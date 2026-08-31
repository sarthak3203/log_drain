import { query } from "../db";
import { getBatchEmbeddings } from "../services/embedding";
import { redis } from '../redis';
const BATCH_SIZE = 100; // embed 100 logs at a time
const WORKER_INTERVAL = 10000; // run every 10 seconds
export async function processEmbeddings(): Promise<void> {
  const items: Array<{ log_id: number; project_id: string; message: string }> = [];
  try {
    // Grab up to BATCH_SIZE items in one Redis request.
    const rawItems = await redis.lpop('embedding_queue', BATCH_SIZE);
    for (const raw of rawItems || []) {
      try {
        const item = JSON.parse(raw) as { log_id?: number; project_id?: string; message?: string };
        if (
          typeof item.log_id !== 'number' ||
          typeof item.project_id !== 'string' ||
          typeof item.message !== 'string'
        ) {
          throw new Error('Embedding queue item is missing log_id, project_id, or message');
        }
        items.push({ log_id: item.log_id, project_id: item.project_id, message: item.message });
      } catch (e) {
        console.error('Skipping malformed embedding queue item:', raw);
      }
    }
    if (items.length === 0) return;
    // Get embeddings in one API call (batch is more efficient)
    const messages = items.map((item) => item.message);
    const embeddings = await getBatchEmbeddings(messages);
    if (embeddings.length !== items.length) {
      throw new Error(`Embedding count mismatch: got ${embeddings.length}, expected ${items.length}`);
    }
    // Update each log with its embedding
    // pgvector accepts vectors as '[0.1, 0.2, ...]' strings
    for (let i = 0; i < items.length; i++) {
      if (!embeddings[i]) {
        console.error(`Missing embedding for log ${items[i].log_id}`);
        continue;
      }
      const vectorStr = `[${embeddings[i].join(",")}]`;
      await query(`UPDATE logs SET embedding = $1 WHERE id = $2 AND project_id = $3`, [
        vectorStr,
        items[i].log_id,
        items[i].project_id,
      ]);
    }
    console.log(`Embedded ${items.length} logs`);
  } catch (err) {
    console.error('Embedding worker error:', err);
    // Push failed items back to the queue so they are retried
    // on the next worker cycle instead of being lost forever
    try {
      const pipeline = redis.pipeline();
      for (const item of items) {
        pipeline.rpush('embedding_queue', JSON.stringify(item));
      }
      await pipeline.exec();
      console.log(`Pushed ${items.length} failed items back to embedding queue for retry`);
    } catch (pushErr) {
      console.error('Failed to push items back to queue:', pushErr);
    }
  }
}
export function startEmbeddingWorker(): void {
  console.log("Embedding worker started");
  setInterval(processEmbeddings, WORKER_INTERVAL);
}
