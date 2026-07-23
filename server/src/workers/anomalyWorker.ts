import { query } from "../db";
import { fireAlert } from '../routes/alerts';
const WORKER_INTERVAL = 5 * 60 * 1000; // run every 5 minutes
const SAMPLE_SIZE = 200; // use last 200 logs to compute centroid
const ANOMALY_THRESHOLD_STD = 2; // flag if > 2 standard deviations from mean distance;
export async function detectAnomalies(): Promise<void> {
  try {
    // Get all active services across all projects
    const services = await query<{ project_id: string; service: string }>(
      `SELECT DISTINCT project_id, service
 FROM logs
 WHERE timestamp > NOW() - INTERVAL '1 hour'
 AND embedding IS NOT NULL`,
    );
    for (const { project_id, service } of services) {
      await detectAnomaliesForService(project_id, service);
    }
  } catch (err) {
    console.error("Anomaly detection error:", err);
  }
}
async function detectAnomaliesForService(
  project_id: string,
  service: string,
): Promise<void> {
  // Step 1: Get recent logs with their embeddings
  const recentLogs = await query<{ id: number; embedding: number[] }>(
    `SELECT id, embedding
 FROM logs
 WHERE project_id = $1
 AND service = $2
 AND embedding IS NOT NULL
 AND timestamp > NOW() - INTERVAL '1 hour'
 ORDER BY timestamp DESC
 LIMIT $3`,
    [project_id, service, SAMPLE_SIZE],
  );
  if (recentLogs.length < 10) return; // need enough data for meaningful stats
  // Postgres returns vectors as a string like "[0.1,0.2,...]"
  // Parse them back to number arrays
  const validPairs: Array<{ id: number; embedding: number[] }> = [];
  for (const log of recentLogs) {
    try {
      const raw = log.embedding as any;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!Array.isArray(parsed) || parsed.length !== 1536) {
        console.error(`Invalid embedding dimensions for log ${log.id}`);
        continue;
      }
      validPairs.push({ id: log.id, embedding: parsed as number[] });
    } catch (e) {
      console.error(`Skipping malformed embedding for log ${log.id}`);
    }
  }
  if (validPairs.length < 10) return;

  const embeddings = validPairs.map(p => p.embedding);
  const dims = embeddings[0].length; // 384
  // Step 2: Compute the centroid
  // The centroid is just the element-wise average of all vectors
  // It represents "what normal looks like for this service"
  const centroid = new Array(dims).fill(0);
  for (const embedding of embeddings) {
    for (let d = 0; d < dims; d++) {
      centroid[d] += embedding[d];
    }
  }
  for (let d = 0; d < dims; d++) {
    centroid[d] /= embeddings.length;
  }
  // Step 3: Calculate cosine distance of each log from the centroid
  // Cosine distance = 1 - cosine_similarity
  // 0 = identical direction, 2 = opposite directions
  const distances = embeddings.map((embedding) =>
    cosineDist(embedding, centroid),
  );
  // Step 4: Find mean and standard deviation of distances
  const meanDist = distances.reduce((a, b) => a + b, 0) / distances.length;
  const variance =
    distances.reduce((a, b) => a + Math.pow(b - meanDist, 2), 0) /
    distances.length;
  const stdDist = Math.sqrt(variance);
  // Step 5: Flag logs more than N standard deviations away
  const anomalyThreshold = meanDist + ANOMALY_THRESHOLD_STD * stdDist;
  const updates: Array<{ id: number; distance: number; isAnomaly: boolean }> =
    [];
  for (let i = 0; i < validPairs.length; i++) {
    updates.push({
      id: validPairs[i].id,
      distance: distances[i],
      isAnomaly: distances[i] > anomalyThreshold,
    });
  }
  // Step 6: Update logs in the database
  for (const update of updates) {
    if (update.isAnomaly) {
      await query(
        `UPDATE logs
 SET anomaly_score = $1, is_anomaly = TRUE
 WHERE id = $2 AND is_anomaly = FALSE`, // don't overwrite already-flagged
        [update.distance, update.id],
      );
    }
  }
  const anomalyCount = updates.filter((u) => u.isAnomaly).length;
  if (anomalyCount > 0) {
    console.log(`Anomaly detection: ${service} — ${anomalyCount} anomalies found
(threshold: ${anomalyThreshold.toFixed(4)})`);
    if (anomalyCount > 0) {
      try {
        const activeRules = await query<{
          id: string;
          project_id: string;
          notify_url: string;
          notify_email: string;
        }>(
          `SELECT id, project_id, notify_url, notify_email
       FROM alert_rules
       WHERE project_id = $1
         AND active = TRUE
         AND (condition->>'type' = 'anomaly')`,
          [project_id]
        );

        for (const rule of activeRules) {
          await fireAlert(rule.id, project_id, {
            service,
            anomaly_count: anomalyCount,
            threshold: anomalyThreshold,
            detected_at: new Date().toISOString(),
          });
        }
      } catch (alertErr) {
        console.error('Failed to fire anomaly alerts:', alertErr);
      }
    }
  }
}
// Cosine distance between two vectors
// Returns 0 (identical) to 2 (opposite)
function cosineDist(a: number[], b: number[]): number {
  let dot = 0,
    magA = 0,
    magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 1; // zero vector edge case
  return 1 - dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
export function startAnomalyWorker(): void {
  console.log("Anomaly detection worker started");
  // Run immediately on startup, then every WORKER_INTERVAL
  detectAnomalies();
  setInterval(detectAnomalies, WORKER_INTERVAL);
}
