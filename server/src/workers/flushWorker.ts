import { Redis } from 'ioredis';
import { db } from '../db';

const redis = new Redis(process.env.REDIS_URL!);
const BATCH_SIZE = 500;
const FLUSH_INTERVAL_MS = 2000;
const INPUT_QUEUE = 'log_buffer';
const PROCESSING_QUEUE = 'log_processing';
const DEAD_LETTER_QUEUE = 'log_dead_letter';
const LOCK_KEY = 'log_flush_worker_lock';
const LOCK_TTL_MS = 120_000;

const RELEASE_LOCK_SCRIPT = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  end
  return 0
`;

const RENEW_LOCK_SCRIPT = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('PEXPIRE', KEYS[1], ARGV[2])
  end
  return 0
`;

interface BufferedLog {
  ingestion_id: string;
  project_id: string;
  level: string;
  message: string;
  service: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

interface PersistedLog {
  id: number;
  project_id: string;
  message: string;
}

function parseBufferedLog(raw: string): BufferedLog {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Queue item is not an object');

  const log = value as Partial<BufferedLog>;
  if (
    typeof log.ingestion_id !== 'string' ||
    typeof log.project_id !== 'string' ||
    typeof log.message !== 'string' ||
    typeof log.level !== 'string' ||
    typeof log.service !== 'string' ||
    typeof log.timestamp !== 'string' ||
    !log.metadata ||
    typeof log.metadata !== 'object' ||
    Array.isArray(log.metadata)
  ) {
    throw new Error('Queue item is missing required log fields');
  }

  return log as BufferedLog;
}

async function releaseLock(token: string): Promise<void> {
  await redis.eval(RELEASE_LOCK_SCRIPT, 1, LOCK_KEY, token);
}

async function restoreUnacknowledgedLogs(): Promise<void> {
  for (let moved = 0; moved < BATCH_SIZE; moved += 1) {
    const raw = await redis.lmove(PROCESSING_QUEUE, INPUT_QUEUE, 'RIGHT', 'LEFT');
    if (!raw) return;
  }
}

async function claimLogs(): Promise<string[]> {
  const claimed: string[] = [];
  for (let count = 0; count < BATCH_SIZE; count += 1) {
    const raw = await redis.lmove(INPUT_QUEUE, PROCESSING_QUEUE, 'LEFT', 'RIGHT');
    if (!raw) break;
    claimed.push(raw);
  }
  return claimed;
}

async function deadLetter(raw: string, error: Error): Promise<void> {
  await redis.rpush(
    DEAD_LETTER_QUEUE,
    JSON.stringify({ raw, error: error.message, failed_at: new Date().toISOString() }),
  );
  await redis.lrem(PROCESSING_QUEUE, 1, raw);
  console.error('Moved malformed log queue item to dead-letter queue:', error.message);
}

async function persistLogs(logs: BufferedLog[]): Promise<PersistedLog[]> {
  const placeholders: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  for (const log of logs) {
    placeholders.push(
      `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`,
    );
    values.push(
      log.ingestion_id,
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
    await client.query('BEGIN');
    const result = await client.query<PersistedLog>(
      `INSERT INTO logs (ingestion_id, project_id, level, message, service, timestamp, metadata)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (project_id, ingestion_id)
       DO UPDATE SET ingestion_id = EXCLUDED.ingestion_id
       RETURNING id, project_id, message`,
      values,
    );
    await client.query('COMMIT');
    return result.rows;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function enqueueEmbeddings(logs: PersistedLog[]): Promise<void> {
  if (logs.length === 0) return;
  const pipeline = redis.pipeline();
  for (const log of logs) {
    pipeline.rpush(
      'embedding_queue',
      JSON.stringify({ log_id: log.id, project_id: log.project_id, message: log.message }),
    );
  }

  const results = await pipeline.exec();
  if (!results || results.some(([error]) => error)) {
    throw new Error('Failed to enqueue one or more persisted logs for embedding');
  }
}

async function acknowledgeLogs(rawLogs: string[]): Promise<void> {
  const pipeline = redis.pipeline();
  for (const raw of rawLogs) pipeline.lrem(PROCESSING_QUEUE, 1, raw);
  const results = await pipeline.exec();
  if (!results || results.some(([error]) => error)) {
    throw new Error('Failed to acknowledge one or more persisted log queue items');
  }
}

export async function flushLogs(): Promise<void> {
  const token = `${process.pid}:${Date.now()}:${Math.random()}`;
  const acquired = await redis.set(LOCK_KEY, token, 'PX', LOCK_TTL_MS, 'NX');
  if (acquired !== 'OK') return;

  const heartbeat = setInterval(() => {
    void redis.eval(RENEW_LOCK_SCRIPT, 1, LOCK_KEY, token, LOCK_TTL_MS).catch((error) => {
      console.error('Unable to renew log flush worker lock:', error);
    });
  }, Math.floor(LOCK_TTL_MS / 3));

  try {
    // A crash after the database commit but before acknowledgement leaves work
    // here. Replaying it is safe because ingestion_id makes the INSERT idempotent.
    await restoreUnacknowledgedLogs();
    const rawLogs = await claimLogs();
    if (rawLogs.length === 0) return;

    const validRawLogs: string[] = [];
    const logs: BufferedLog[] = [];
    const seenIngestionIds = new Set<string>();
    for (const raw of rawLogs) {
      try {
        const log = parseBufferedLog(raw);
        validRawLogs.push(raw);
        const idempotencyKey = `${log.project_id}:${log.ingestion_id}`;
        if (!seenIngestionIds.has(idempotencyKey)) {
          seenIngestionIds.add(idempotencyKey);
          logs.push(log);
        }
      } catch (error) {
        await deadLetter(raw, error instanceof Error ? error : new Error('Invalid queue item'));
      }
    }
    if (logs.length === 0) return;

    const persisted = await persistLogs(logs);
    // Do not acknowledge Redis until both persistence and downstream queueing
    // have completed. On a failure the claimed records remain retryable.
    await enqueueEmbeddings(persisted);
    await acknowledgeLogs(validRawLogs);
    console.log(`Flushed ${logs.length} logs to Postgres`);
  } catch (error) {
    console.error('Flush worker error; claimed logs will be retried:', error);
  } finally {
    clearInterval(heartbeat);
    await releaseLock(token).catch((error) => {
      console.error('Unable to release log flush worker lock:', error);
    });
  }
}

export function startFlushWorker(): void {
  console.log('Flush worker started');
  void flushLogs();
  setInterval(() => void flushLogs(), FLUSH_INTERVAL_MS);
}
