import { Router } from "express";
import { Redis } from "ioredis";
import { apiKeyAuth } from "../middleware/apiKey";
import { query } from "../db";
import { LogInput } from "../types";
const router = Router();
const redis = new Redis(process.env.REDIS_URL!);
// POST /api/v1/logs
// Accepts single log or array of logs
// Returns 202 Accepted immediately — does NOT wait for DB write
router.post("/logs", apiKeyAuth, async (req, res) => {
  const project_id = req.project_id;
  const body = req.body;
  // Normalize: accept both single log and array
  const logs: LogInput[] = Array.isArray(body) ? body : [body];
  if (logs.length === 0) {
    return res.status(400).json({ error: "No logs provided" });
  }
  if (logs.length > 1000) {
    return res.status(400).json({ error: "Max 1000 logs per request" });
  }
  // Validate
  for (const log of logs) {
    if (!log.message) {
      return res
        .status(400)
        .json({ error: "Each log must have a message field" });
    }
  }
  try {
    // Push to Redis buffer, don't wait for DB
    // Each log is JSON-stringified and pushed to a Redis list
    // The flush worker will pick these up every 2 seconds
    const pipeline = redis.pipeline();
    for (const log of logs) {
      const entry = JSON.stringify({
        project_id,
        level: log.level || "INFO",
        message: log.message,
        service: log.service || "unknown",
        timestamp: log.timestamp || new Date().toISOString(),
        metadata: log.metadata || {},
      });
      pipeline.rpush("log_buffer", entry);
    }
    await pipeline.exec();
    // 202 = "Accepted for processing" (not yet completed)
    res.status(202).json({
      accepted: logs.length,
      message: "Logs accepted for processing",
    });
  } catch (err) {
    console.error("Log ingestion error:", err);
    res.status(500).json({ error: "Failed to accept logs" });
  }
});
// GET /api/v1/logs — filtered log retrieval with cursor pagination
router.get("/logs", apiKeyAuth, async (req, res) => {
  try {
    const project_id = req.project_id;
    const {
      level,
      service,
      from,
      to,
      cursor,
      limit = "50",
    } = req.query as Record<string, string>;
    if (from && isNaN(new Date(from).getTime())) {
      res.status(400).json({ error: "Invalid from date" });
      return;
    }
    if (to && isNaN(new Date(to).getTime())) {
      res.status(400).json({ error: "Invalid to date" });
      return;
    }
    const parsed = Number.parseInt(limit, 10);
    const limitNum = Number.isFinite(parsed) ? Math.min(parsed, 200) : 50;
    // Build query dynamically
    const conditions: string[] = ["project_id = $1"];
    const params: any[] = [project_id];
    let paramIndex = 2;
    if (level) {
      conditions.push(`level = $${paramIndex++}`);
      params.push(level.toUpperCase());
    }
    if (service) {
      conditions.push(`service = $${paramIndex++}`);
      params.push(service);
    }
    if (from) {
      conditions.push(`timestamp >= $${paramIndex++}`);
      params.push(new Date(from));
    }
    if (to) {
      conditions.push(`timestamp <= $${paramIndex++}`);
      params.push(new Date(to));
    }
    // Cursor-based pagination: cursor is the last seen log ID
    // More efficient than OFFSET because OFFSET scans and discards rows
    if (cursor) {
      conditions.push(`id < $${paramIndex++}`);
      params.push(parseInt(cursor));
    }
    const whereClause = conditions.join(" AND ");
    const logs = await query(
      `SELECT id, level, message, service, timestamp, metadata, is_anomaly, anomaly_score
 FROM logs
 WHERE ${whereClause}
 ORDER BY id DESC
 LIMIT $${paramIndex}`,
      [...params, limitNum + 1], // fetch one extra to know if there's a next page
    );
    // If we got limitNum+1 results, there are more
    const hasMore = logs.length > limitNum;
    const results = hasMore ? logs.slice(0, limitNum) : logs;
    const nextCursor = hasMore ? results[results.length - 1].id : null;
    res.json({
      logs: results,
      next_cursor: nextCursor,
      has_more: hasMore,
    });
  } catch (err) {
    console.error("Get logs error:", err);
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});
// GET /api/v1/services — list services sending logs
router.get("/services", apiKeyAuth, async (req, res) => {
  const project_id = req.project_id;
  const services = await query(
    `SELECT service, COUNT(*) as log_count, MAX(timestamp) as last_seen
 FROM logs
 WHERE project_id = $1
 GROUP BY service
 ORDER BY last_seen DESC`,
    [project_id],
  );
  res.json(services);
});
export default router;
