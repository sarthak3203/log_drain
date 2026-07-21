import { Router } from "express";
import { apiKeyAuth } from "../middleware/apiKey";
import { query } from "../db";
import { getEmbedding } from "../services/embedding";
import { generateSearchAnswer } from "../services/llm";
const router = Router();
// GET /api/v1/search?q=database+connection+failures&from=...&to=...&limit=10
router.get("/search", apiKeyAuth, async (req, res) => {
  const project_id = req.project_id;
  const {
    q: userQuery,
    from,
    to,
    service,
    limit = "10",
  } = req.query as Record<string, string>;
  if (!userQuery) {
    return res.status(400).json({ error: "Query parameter q is required" });
  }
  if (from && isNaN(new Date(from).getTime())) {
    res.status(400).json({ error: "Invalid from date" });
    return;
  }
  if (to && isNaN(new Date(to).getTime())) {
    res.status(400).json({ error: "Invalid to date" });
    return;
  }
  const parsed = Number.parseInt(limit, 10);
  const limitNum = Number.isFinite(parsed) ? Math.min(parsed, 50) : 10;
  try {
    // Step 1: Convert the user's question to a vector
    const queryEmbedding = await getEmbedding(userQuery);
    const queryVector = `[${queryEmbedding.join(",")}]`;
    // Step 2: Build time/service filters
    const conditions: string[] = [
      "project_id = $2",
      "embedding IS NOT NULL", // only logs that have been embedded
    ];
    const params: any[] = [queryVector, project_id];
    let paramIndex = 3;
    if (from) {
      conditions.push(`timestamp >= $${paramIndex++}`);
      params.push(new Date(from));
    }
    if (to) {
      conditions.push(`timestamp <= $${paramIndex++}`);
      params.push(new Date(to));
    }
    if (service) {
      conditions.push(`service = $${paramIndex++}`);
      params.push(service);
    }
    const whereClause = conditions.join(" AND ");
    // Step 3: Vector similarity search
    // The <-> operator is cosine distance in pgvector
    // ORDER BY this = most similar logs first
    const similarLogs = await query(
      `SELECT
 id, level, message, service, timestamp, metadata,
 1 - (embedding <=> $1::vector) as similarity_score
 FROM logs
 WHERE ${whereClause}
 ORDER BY embedding <=> $1::vector
 LIMIT $${paramIndex}`,
      [...params, limitNum],
    );
    if (similarLogs.length === 0) {
      return res.json({
        answer: "No relevant logs found for your query.",
        logs: [],
        query: userQuery,
      });
    }
    // Step 4: Generate plain-English answer using the retrieved logs
    const answer = await generateSearchAnswer(userQuery, similarLogs as any);
    res.json({
      answer,
      logs: similarLogs,
      query: userQuery,
      logs_searched: similarLogs.length,
    });
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Search failed" });
  }
});
export default router;
