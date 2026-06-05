import { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import { query } from "../db";
export async function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Keys come in the Authorization header as: "Bearer log_abc123..."
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing API key" });
    return;
  }

  const rawKey = authHeader.substring(7); // strip "Bearer "
  try {
    // Fetch all non-revoked keys and check each hash
    // Why not query by hash directly? bcrypt hashes are non-deterministic
    // (different salt each time), so you can't query WHERE key_hash = bcrypt(input)
    // Solution: store a key prefix in plaintext for fast lookup, then verify full hash
    // We'll use the first 8 chars of the key as a lookup prefix
    const prefix = rawKey.substring(0, 8);

    const keys = await query<{
      id: string;
      project_id: string;
      key_hash: string;
    }>(
      `SELECT id, project_id, key_hash
 FROM api_keys
 WHERE key_hash LIKE $1 AND revoked = FALSE`,
      [`${prefix}%`], // this is still not ideal; see tradeoff note below
    );
    // Actually the better pattern: store prefix separately
    // For this tutorial, we'll verify all non-revoked keys (there won't be thousands)
    const allKeys = await query<{
      id: string;
      project_id: string;
      key_hash: string;
    }>(`SELECT id, project_id, key_hash FROM api_keys WHERE revoked = FALSE`);
    let matchedKey: { id: string; project_id: string } | null = null;
    for (const key of allKeys) {
      const matches = await bcrypt.compare(rawKey, key.key_hash);
      if (matches) {
        matchedKey = { id: key.id, project_id: key.project_id };
        break;
      }
    }
    if (!matchedKey) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }
    // Attach to request for use in route handlers
    (req as any).project_id = matchedKey.project_id;
    (req as any).api_key_id = matchedKey.id;
    // Update last_used asynchronously (don't await — don't slow down the request)
    query(`UPDATE api_keys SET last_used = NOW() WHERE id = $1`, [
      matchedKey.id,
    ]).catch((err) => console.error("Failed to update last_used:", err));
    next();
  } catch (err) {
    console.error("API key auth error:", err);
    res.status(500).json({ error: "Authentication error" });
  }
}
