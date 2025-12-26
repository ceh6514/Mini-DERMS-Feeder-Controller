import crypto from 'crypto';
import { NextFunction, Request, Response, Router } from 'express';
import config from './config';
import { verifyPassword } from './security/passwords';
import logger from './logger';

export type UserRole = 'viewer' | 'operator' | 'admin';

export interface AuthenticatedUser {
  username: string;
  role: UserRole;
}

type JwtAlgorithm = 'HS256';

interface TokenPayload extends AuthenticatedUser {
  exp: number;
  iat: number;
  nbf?: number;
  iss: string;
  aud: string;
}

const roleRank: Record<UserRole, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
};

const supportedAlgs: JwtAlgorithm[] = ['HS256'];

function base64url(input: Buffer | string): string {
  return Buffer.isBuffer(input)
    ? input.toString('base64url')
    : Buffer.from(input).toString('base64url');
}

function encodeHeader(alg: JwtAlgorithm) {
  return base64url(JSON.stringify({ alg, typ: 'JWT' }));
}

async function signToken(user: AuthenticatedUser): Promise<string> {
  const header = encodeHeader('HS256');
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    ...user,
    iat: nowSeconds,
    exp: nowSeconds + config.auth.tokenTtlHours * 60 * 60,
    iss: config.auth.issuer,
    aud: config.auth.audience,
  };

  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${header}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', config.auth.jwtSecret)
    .update(signingInput)
    .digest('base64url');

  return `${signingInput}.${signature}`;
}

function validateSignature(
  headerB64: string,
  payloadB64: string,
  signatureB64: string,
  alg: JwtAlgorithm,
) {
  if (!supportedAlgs.includes(alg)) {
    return false;
  }
  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSignature = crypto
    .createHmac('sha256', config.auth.jwtSecret)
    .update(signingInput)
    .digest('base64url');
  const provided = Buffer.from(signatureB64);
  const expected = Buffer.from(expectedSignature);
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

function validateClaims(payload: TokenPayload): payload is TokenPayload {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const tolerance = config.auth.clockToleranceSeconds;
  if (typeof payload.exp !== 'number' || payload.exp < nowSeconds - tolerance) return false;
  if (typeof payload.iat !== 'number' || payload.iat > nowSeconds + tolerance) return false;
  if (payload.nbf !== undefined && payload.nbf > nowSeconds + tolerance) return false;
  if (payload.iss !== config.auth.issuer || payload.aud !== config.auth.audience) return false;
  if (!['viewer', 'operator', 'admin'].includes(payload.role)) return false;
  if (!payload.username) return false;
  return true;
}

async function verifyToken(token: string): Promise<TokenPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signature] = parts;

  let header: { alg?: JwtAlgorithm; typ?: string };
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
  } catch (err) {
    logger.error(err as Error, '[auth] failed to parse token header');
    return null;
  }

  if (header.typ !== 'JWT' || !header.alg) {
    return null;
  }

  if (!validateSignature(headerB64, payloadB64, signature, header.alg)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as TokenPayload;
    if (!validateClaims(payload)) {
      return null;
    }
    return payload;
  } catch (err) {
    logger.error(err as Error, '[auth] failed to parse token payload');
    return null;
  }
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }

    const token = authHeader.slice('Bearer '.length);
    const payload = await verifyToken(token);
    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.user = { username: payload.username, role: payload.role };
    return next();
  } catch (err) {
    return next(err);
  }
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

authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const user = config.auth.users.find((u) => u.username === username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = await signToken({ username: user.username, role: user.role });
  res.json({ token, user: { username: user.username, role: user.role } });
});

export function getRoleFromRequest(req: AuthenticatedRequest): UserRole | null {
  return req.user?.role ?? null;
}
