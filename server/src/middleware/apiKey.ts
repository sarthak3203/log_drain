import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { query } from '../db';

export async function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing API key' });
    return;
  }

  const rawKey = authHeader.substring(7);

  try {
    const prefix = rawKey.slice(0, 12);

    const candidates = await query<{
      id: string;
      project_id: string;
      key_hash: string;
    }>(
      `SELECT id, project_id, key_hash 
       FROM api_keys 
       WHERE key_prefix = $1 AND revoked = FALSE`,
      [prefix]
    );

    let matchedKey: { id: string; project_id: string } | null = null;
    for (const key of candidates) {
      const matches = await bcrypt.compare(rawKey, key.key_hash);
      if (matches) {
        matchedKey = { id: key.id, project_id: key.project_id };
        break;
      }
    }

    if (!matchedKey) {
      res.status(401).json({ error: 'Invalid API key' });
      return;
    }

    req.project_id = matchedKey.project_id;
    req.api_key_id = matchedKey.id;

    query(
      `UPDATE api_keys SET last_used = NOW() WHERE id = $1`,
      [matchedKey.id]
    ).catch(err => console.error('Failed to update last_used:', err));

    next();
  } catch (err) {
    console.error('API key auth error:', err);
    res.status(500).json({ error: 'Authentication error' });
  }
}
