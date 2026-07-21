import { Router } from "express";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import { query } from "../db";
import { apiKeyAuth } from "../middleware/apiKey";
const router = Router();
// Create a new project + first API key
// This is the "sign up" flow: POST /api/v1/projects
router.post("/projects", async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Project name is required" });
  }
  try {
    // Create project
    const [project] = await query<{ id: string; name: string }>(
      `INSERT INTO projects (name) VALUES ($1) RETURNING id, name`,
      [name],
    );
    // Generate a raw API key
    // Format: "log_" prefix makes it obvious what this key is for
    const rawKey = `log_${uuidv4().replace(/-/g, "")}`;
    const keyPrefix = rawKey.slice(0, 12);

    // Hash it before storing
    const keyHash = await bcrypt.hash(rawKey, 10); // 10 = bcrypt cost factor
    await query(
      `INSERT INTO api_keys (project_id, key_hash, key_prefix, name) VALUES ($1, $2, $3, $4)`,
      [project.id, keyHash, keyPrefix, "Default key"],
    );
    // THIS IS THE ONLY TIME WE RETURN THE RAW KEY
    // It's never stored. If lost, user must create a new key.
    res.status(201).json({
      project,
      api_key: rawKey, // save this! not shown again
      message: "Save your API key — it will not be shown again",
    });
  } catch (err) {
    console.error("Create project error:", err);
    res.status(500).json({ error: "Failed to create project" });
  }
});
// Create additional API keys for a project
router.post("/api-keys", apiKeyAuth, async (req, res) => {
  const { name } = req.body;
  const project_id = req.project_id;
  const rawKey = `log_${uuidv4().replace(/-/g, "")}`;
  const keyPrefix = rawKey.slice(0, 12);
  const keyHash = await bcrypt.hash(rawKey, 10);
  await query(
    `INSERT INTO api_keys (project_id, key_hash, key_prefix, name) VALUES ($1, $2, $3, $4)`,
    [project_id, keyHash, keyPrefix, name || "API Key"],
  );
  res.status(201).json({ api_key: rawKey });
});
// List API keys (shows metadata but NOT the actual key — it's hashed)
router.get("/api-keys", apiKeyAuth, async (req, res) => {
  const project_id = req.project_id;
  const keys = await query(
    `SELECT id, name, created_at, last_used, revoked
 FROM api_keys WHERE project_id = $1`,
    [project_id],
  );
  res.json(keys);
});
// Revoke a key
router.delete("/api-keys/:id", apiKeyAuth, async (req, res) => {
  const project_id = req.project_id;
  await query(
    `UPDATE api_keys SET revoked = TRUE
 WHERE id = $1 AND project_id = $2`,
    [req.params.id, project_id],
  );
  res.json({ message: "Key revoked" });
});
export default router;
