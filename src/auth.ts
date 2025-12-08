import crypto from 'crypto';
import { NextFunction, Request, Response, Router } from 'express';
import config from './config';

export type UserRole = 'viewer' | 'operator' | 'admin';

export interface AuthenticatedUser {
  username: string;
  role: UserRole;
}

interface TokenPayload extends AuthenticatedUser {
  exp: number;
  iat: number;
}

const roleRank: Record<UserRole, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
};

function base64url(input: Buffer | string): string {
  return Buffer.isBuffer(input)
    ? input.toString('base64url')
    : Buffer.from(input).toString('base64url');
}

function signToken(user: AuthenticatedUser): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    ...user,
    iat: nowSeconds,
    exp: nowSeconds + config.auth.tokenTtlHours * 60 * 60,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', config.auth.jwtSecret)
    .update(signingInput)
    .digest('base64url');

  return `${signingInput}.${signature}`;
}

function verifyToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signature] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSignature = crypto
    .createHmac('sha256', config.auth.jwtSecret)
    .update(signingInput)
    .digest('base64url');

  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  if (provided.length !== expected.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(provided, expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as TokenPayload;
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (payload.exp < nowSeconds) {
      return null;
    }
    return payload;
  } catch (err) {
    console.error('[auth] failed to parse token payload', err);
    return null;
  }
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }

  const token = authHeader.slice('Bearer '.length);
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = { username: payload.username, role: payload.role };
  return next();
}

export function requireRole(role: UserRole) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const currentRank = roleRank[req.user.role];
    const requiredRank = roleRank[role];

    if (currentRank < requiredRank) {
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }

    return next();
  };
}

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const user = config.auth.users.find((u) => u.username === username && u.password === password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = signToken({ username: user.username, role: user.role });
  res.json({ token, user: { username: user.username, role: user.role } });
});

export function getRoleFromRequest(req: AuthenticatedRequest): UserRole | null {
  return req.user?.role ?? null;
}
