import crypto from 'crypto';

const KEY_LEN = 64;
const SALT_LEN = 16;
const WORK_FACTOR = { N: 16384, r: 8, p: 1 };
const HASH_PREFIX = 'scrypt';
const HASH_REGEX = /^scrypt:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/;

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LEN, WORK_FACTOR, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(derivedKey as Buffer);
    });
  });
}

export function isValidPasswordHash(hash: string | undefined): hash is string {
  return typeof hash === 'string' && HASH_REGEX.test(hash);
}

export async function hashPassword(password: string): Promise<string> {
  if (!password) {
    throw new Error('Password is required');
  }

  const salt = crypto.randomBytes(SALT_LEN);
  const derivedKey = await deriveKey(password, salt);
  return `${HASH_PREFIX}:${salt.toString('base64')}:${derivedKey.toString('base64')}`;
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  if (!password || !isValidPasswordHash(passwordHash)) {
    return false;
  }

  const [, saltB64, keyB64] = passwordHash.split(':');
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');

  const derived = await deriveKey(password, salt);
  if (derived.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(derived, expected);
}
