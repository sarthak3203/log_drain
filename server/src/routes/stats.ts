import { Router } from "express";
import { apiKeyAuth } from "../middleware/apiKey";
import { query } from "../db";
const router = Router();
// GET /api/v1/stats — log volume over time, for dashboard charts
router.get("/stats", apiKeyAuth, async (req, res) => {
  const project_id = req.project_id;
  const { hours = "24" } = req.query as Record<string, string>;
  const parsed = Number.parseInt(hours, 10);
  const hoursNum = Number.isFinite(parsed) ? Math.min(parsed, 168) : 24;
  // date_trunc groups timestamps by hour
  const volumeStats = await query(
    `SELECT
 date_trunc('hour', timestamp) as hour,
 service,
 level,
 COUNT(*) as count
 FROM logs
 WHERE project_id = $1
 AND timestamp > NOW() - ($2::int * INTERVAL '1 hour')
 GROUP BY hour, service, level
 ORDER BY hour ASC`,
    [project_id, hoursNum],
  );
  // Error rate per service
  const errorRates = await query(
    `SELECT
 service,
 COUNT(*) FILTER (WHERE level = 'ERROR') as errors,
 COUNT(*) as total,
 ROUND(COUNT(*) FILTER (WHERE level = 'ERROR') * 100.0 / COUNT(*), 2) as
error_rate_pct
 FROM logs
 WHERE project_id = $1
 AND timestamp > NOW() - INTERVAL '24 hours'
 GROUP BY service`,
    [project_id],
  );
  // Recent anomaly count
  const anomalies = await query(
    `SELECT COUNT(*) as count
 FROM logs
 WHERE project_id = $1
 AND is_anomaly = TRUE
 AND timestamp > NOW() - INTERVAL '24 hours'`,
    [project_id],
  );
  res.json({
    volume_by_hour: volumeStats,
    error_rates: errorRates,
    anomaly_count_24h: anomalies[0]?.count || 0,
  });
});
export default router;
