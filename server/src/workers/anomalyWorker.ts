import 'dotenv/config';
import axios from 'axios';
import { query } from '../db';
import { fireAlert } from '../routes/alerts';

const WORKER_INTERVAL = 5 * 60 * 1000;
const SAMPLE_SIZE = 200;
const PYTHON_ML_URL = process.env.PYTHON_ML_URL || 'http://localhost:8000';

export async function detectAnomalies(): Promise<void> {
  try {
    // First check if Python ML service is available
    try {
      await axios.get(`${PYTHON_ML_URL}/health`, { timeout: 3000 });
    } catch (err) {
      console.warn('Python ML service unavailable, skipping anomaly detection');
      return;
    }

    const services = await query<{ project_id: string; service: string }>(
      `SELECT DISTINCT project_id, service
       FROM logs
       WHERE timestamp > NOW() - INTERVAL '1 hour'
         AND embedding IS NOT NULL`
    );

    for (const { project_id, service } of services) {
      await detectAnomaliesForService(project_id, service);
    }
  } catch (err) {
    console.error('Anomaly detection error:', err);
  }
}

async function detectAnomaliesForService(
  project_id: string,
  service: string
): Promise<void> {
  try {
    // Fetch recent logs with embeddings
    const recentLogs = await query<{ id: number; embedding: any }>(
      `SELECT id, embedding
       FROM logs
       WHERE project_id = $1
         AND service = $2
         AND embedding IS NOT NULL
         AND timestamp > NOW() - INTERVAL '1 hour'
       ORDER BY timestamp DESC
       LIMIT $3`,
      [project_id, service, SAMPLE_SIZE]
    );

    if (recentLogs.length < 10) return;

    // Parse embeddings and filter invalid ones
    const validPairs: Array<{ id: number; embedding: number[] }> = [];
    for (const log of recentLogs) {
      try {
        const raw = log.embedding as any;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!Array.isArray(parsed) || parsed.length !== 1536) {
          console.error(`Invalid embedding dimensions for log ${log.id}`);
          continue;
        }
        validPairs.push({ id: log.id, embedding: parsed });
      } catch (e) {
        console.error(`Skipping malformed embedding for log ${log.id}`);
      }
    }

    if (validPairs.length < 10) return;

    // Call Python ML service for IsolationForest detection
    const response = await axios.post(
      `${PYTHON_ML_URL}/detect-anomalies`,
      {
        project_id,
        service,
        log_ids: validPairs.map(p => p.id),
        embeddings: validPairs.map(p => p.embedding),
        contamination: 0.1,
      },
      { timeout: 30000 }  // 30s timeout for large batches
    );

    const { results, anomalies_found } = response.data;

    // Update database with ML results
    for (const result of results) {
      if (result.is_anomaly) {
        await query(
          `UPDATE logs
           SET anomaly_score = $1, is_anomaly = TRUE
           WHERE id = $2 AND is_anomaly = FALSE`,
          [result.anomaly_score, result.log_id]
        );
      }
    }

    if (anomalies_found > 0) {
      console.log(
        `IsolationForest: ${service} — ${anomalies_found} anomalies found ` +
        `out of ${validPairs.length} logs`
      );

      // Fire alert rules
      try {
        // A null or blank service intentionally matches anomalies from all services.
        const activeRules = await query<{ id: string }>(
          `SELECT id
           FROM alert_rules
           WHERE project_id = $1
             AND active = TRUE
             AND (condition->>'type' = 'anomaly')
             AND (service IS NULL OR BTRIM(service) = '' OR service = $2)`,
          [project_id, service]
        );

        for (const rule of activeRules) {
          await fireAlert(rule.id, project_id, {
            service,
            anomaly_count: anomalies_found,
            algorithm: 'IsolationForest',
            detected_at: new Date().toISOString(),
          });
        }
      } catch (alertErr) {
        console.error('Failed to fire anomaly alerts:', alertErr);
      }
    }
  } catch (err: any) {
    if (err?.response?.data) {
      console.error(
        `Anomaly detection failed for ${service}:`,
        err.response.data
      );
    } else {
      console.error(`Anomaly detection failed for ${service}:`, err.message);
    }
  }
}

export function startAnomalyWorker(): void {
  console.log('Anomaly detection worker started (using Python IsolationForest)');
  detectAnomalies();
  setInterval(detectAnomalies, WORKER_INTERVAL);
}
