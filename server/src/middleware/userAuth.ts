import { NextFunction, Request, Response } from 'express';
import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';
import { query } from '../db';

const DEFAULT_JWT_EXPIRES_IN = '7d';

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set to a value of at least 32 characters');
  }
  return secret;
}

function getJwtExpiresIn(): SignOptions['expiresIn'] {
  return (process.env.JWT_EXPIRES_IN || DEFAULT_JWT_EXPIRES_IN) as SignOptions['expiresIn'];
}

export function createUserToken(userId: string, email: string): string {
  return jwt.sign(
    { sub: userId, email, type: 'user' },
    getJwtSecret(),
    { expiresIn: getJwtExpiresIn() },
  );
}

export async function userAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing user access token' });
    return;
  }

  try {
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, getJwtSecret());

    if (
      typeof decoded === 'string' ||
      !(decoded as JwtPayload).sub ||
      (decoded as JwtPayload & { type?: string }).type !== 'user'
    ) {
      res.status(401).json({ error: 'Invalid user access token' });
      return;
    }

    const userId = (decoded as JwtPayload).sub!;
    const [user] = await query<{ id: string }>(
      'SELECT id FROM users WHERE id = $1',
      [userId],
    );

    if (!user) {
      res.status(401).json({ error: 'Invalid user access token' });
      return;
    }

    req.user_id = user.id;
    next();
  } catch (err) {
    console.error('User authentication error:', err);
    res.status(401).json({ error: 'Invalid or expired user access token' });
  }
}
