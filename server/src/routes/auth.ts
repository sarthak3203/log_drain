import { Router } from 'express';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { db, query } from '../db';
import { apiKeyAuth } from '../middleware/apiKey';
import { createUserToken, userAuth } from '../middleware/userAuth';
import { authLimiter } from '../middleware/rateLimiter';

const router = Router();

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
}

function toSafeUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function getRouteParam(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && value ? value : null;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 255;
}

function isValidPassword(password: unknown): password is string {
  return (
    typeof password === 'string' &&
    password.length >= 8 &&
    Buffer.byteLength(password, 'utf8') <= 72
  );
}

interface ApiKeyMetadata {
  id: string;
  name: string | null;
  created_at: Date;
  last_used: Date | null;
  revoked: boolean;
}

function normalizeApiKeyName(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : 'API Key';
}

async function getOwnedProject(userId: string, projectId: string): Promise<boolean> {
  const [project] = await query<{ id: string }>(
    'SELECT id FROM projects WHERE id = $1 AND owner_id = $2',
    [projectId, userId],
  );
  return Boolean(project);
}

async function listProjectApiKeys(projectId: string): Promise<ApiKeyMetadata[]> {
  return query<ApiKeyMetadata>(
    `SELECT id, name, created_at, last_used, revoked
     FROM api_keys
     WHERE project_id = $1
     ORDER BY created_at DESC`,
    [projectId],
  );
}

async function createProjectApiKey(
  projectId: string,
  requestedName: unknown,
): Promise<{ api_key: string; key: ApiKeyMetadata }> {
  const name = normalizeApiKeyName(requestedName);
  if (name.length > 100) throw new Error('API key name must be at most 100 characters');

  const rawKey = `log_${uuidv4().replace(/-/g, '')}`;
  const keyPrefix = rawKey.slice(0, 12);
  const keyHash = await bcrypt.hash(rawKey, 10);
  const [key] = await query<ApiKeyMetadata>(
    `INSERT INTO api_keys (project_id, key_hash, key_prefix, name)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, created_at, last_used, revoked`,
    [projectId, keyHash, keyPrefix, name],
  );
  return { api_key: rawKey, key };
}

async function revokeProjectApiKey(projectId: string, keyId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE api_keys SET revoked = TRUE
     WHERE id = $1 AND project_id = $2 AND revoked = FALSE
     RETURNING id`,
    [keyId, projectId],
  );
  return rows.length > 0;
}

// Register a person and return a user-session JWT.
router.post('/auth/register', authLimiter, async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = req.body?.password;
  const rawName = req.body?.name;
  const name = typeof rawName === 'string' ? rawName.trim() || null : null;

  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'A valid email is required' });
    return;
  }
  if (!isValidPassword(password)) {
    res.status(400).json({ error: 'Password must be 8-72 bytes' });
    return;
  }
  if (name && name.length > 100) {
    res.status(400).json({ error: 'Name must be at most 100 characters' });
    return;
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const [user] = await query<UserRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING id, email, name, password_hash, created_at, updated_at`,
      [email, passwordHash, name],
    );

    res.status(201).json({
      user: toSafeUser(user),
      token: createUserToken(user.id, user.email),
    });
  } catch (err: any) {
    if (err?.code === '23505') {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }
    console.error('User registration error:', err);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// Authenticate a person and return a user-session JWT.
router.post('/auth/login', authLimiter, async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = req.body?.password;

  if (!isValidEmail(email) || typeof password !== 'string') {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  try {
    const [user] = await query<UserRow>(
      `SELECT id, email, name, password_hash, created_at, updated_at
       FROM users
       WHERE email = $1`,
      [email],
    );

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    res.json({
      user: toSafeUser(user),
      token: createUserToken(user.id, user.email),
    });
  } catch (err) {
    console.error('User login error:', err);
    res.status(500).json({ error: 'Failed to log in' });
  }
});

// Return safe account data for the current user session.
router.get('/auth/me', userAuth, async (req, res) => {
  try {
    const [user] = await query<UserRow>(
      `SELECT id, email, name, password_hash, created_at, updated_at
       FROM users
       WHERE id = $1`,
      [req.user_id],
    );

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ user: toSafeUser(user) });
  } catch (err) {
    console.error('Get current user error:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Create a new project and its first API key for the authenticated owner.
router.post('/projects', userAuth, async (req, res) => {
  const rawName = req.body?.name;
  const name = typeof rawName === 'string' ? rawName.trim() : '';

  if (!name || name.length > 100) {
    res.status(400).json({ error: 'Project name must be 1-100 characters' });
    return;
  }

  const rawKey = `log_${uuidv4().replace(/-/g, '')}`;
  const keyPrefix = rawKey.slice(0, 12);

  try {
    const keyHash = await bcrypt.hash(rawKey, 10);
    const client = await db.connect();

    try {
      await client.query('BEGIN');
      const projectResult = await client.query<{
        id: string;
        name: string;
        created_at: Date;
      }>(
        `INSERT INTO projects (owner_id, name)
         VALUES ($1, $2)
         RETURNING id, name, created_at`,
        [req.user_id, name],
      );
      const project = projectResult.rows[0];

      await client.query(
        `INSERT INTO api_keys (project_id, key_hash, key_prefix, name)
         VALUES ($1, $2, $3, $4)`,
        [project.id, keyHash, keyPrefix, 'Default key'],
      );
      await client.query('COMMIT');

      // The raw key is intentionally returned only at project creation time.
      res.status(201).json({
        project,
        api_key: rawKey,
        message: "Save your API key — it will not be shown again",
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Create project error:', err);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// List only projects owned by the authenticated user.
router.get('/projects', userAuth, async (req, res) => {
  try {
    const projects = await query<{
      id: string;
      name: string;
      created_at: Date;
    }>(
      `SELECT id, name, created_at
       FROM projects
       WHERE owner_id = $1
       ORDER BY created_at DESC`,
      [req.user_id],
    );

    res.json(projects);
  } catch (err) {
    console.error('List projects error:', err);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// Owner-authorized API-key management. This is intentionally separate from
// project-key authentication so an owner can recover a project after losing a
// one-time raw key without weakening project-scoped data endpoints.
router.get('/projects/:projectId/api-keys', userAuth, async (req, res) => {
  try {
    const projectId = getRouteParam(req.params.projectId);
    if (!projectId) {
      res.status(400).json({ error: 'Invalid project ID' });
      return;
    }
    if (!(await getOwnedProject(req.user_id!, projectId))) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.json(await listProjectApiKeys(projectId));
  } catch (err) {
    console.error('List owner API keys error:', err);
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

router.post('/projects/:projectId/api-keys', userAuth, async (req, res) => {
  try {
    const projectId = getRouteParam(req.params.projectId);
    if (!projectId) {
      res.status(400).json({ error: 'Invalid project ID' });
      return;
    }
    if (!(await getOwnedProject(req.user_id!, projectId))) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const created = await createProjectApiKey(projectId, req.body?.name);
    res.status(201).json({
      ...created,
      message: 'Save your API key — it will not be shown again',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create API key';
    res.status(400).json({ error: message });
  }
});

router.delete('/projects/:projectId/api-keys/:keyId', userAuth, async (req, res) => {
  try {
    const projectId = getRouteParam(req.params.projectId);
    const keyId = getRouteParam(req.params.keyId);
    if (!projectId || !keyId) {
      res.status(400).json({ error: 'Invalid project or API key ID' });
      return;
    }
    if (!(await getOwnedProject(req.user_id!, projectId))) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (!(await revokeProjectApiKey(projectId, keyId))) {
      res.status(404).json({ error: 'API key not found or already revoked' });
      return;
    }
    res.json({ message: 'Key revoked' });
  } catch (err) {
    console.error('Revoke owner API key error:', err);
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

// The following API-key management routes remain project-key authenticated.
router.post('/api-keys', apiKeyAuth, async (req, res) => {
  try {
    const created = await createProjectApiKey(req.project_id!, req.body?.name);
    res.status(201).json({ api_key: created.api_key });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create API key';
    res.status(400).json({ error: message });
  }
});

// List API-key metadata, never raw key values.
router.get('/api-keys', apiKeyAuth, async (req, res) => {
  res.json(await listProjectApiKeys(req.project_id!));
});

// Revoke a key only if it belongs to the authenticated key's project.
router.delete('/api-keys/:id', apiKeyAuth, async (req, res) => {
  const keyId = getRouteParam(req.params.id);
  if (!keyId) {
    res.status(400).json({ error: 'Invalid API key ID' });
    return;
  }
  const revoked = await revokeProjectApiKey(req.project_id!, keyId);
  if (!revoked) {
    res.status(404).json({ error: 'API key not found or already revoked' });
    return;
  }
  res.json({ message: 'Key revoked' });
});

// A project API key may disclose only the project identity it already grants
// access to. The frontend uses this to reject a key pasted for the wrong project.
router.get('/project-context', apiKeyAuth, (req, res) => {
  res.json({ project_id: req.project_id });
});

export default router;
