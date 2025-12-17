#!/usr/bin/env node
const crypto = require('crypto');

const KEY_LEN = 64;
const SALT_LEN = 16;
const WORK_FACTOR = { N: 16384, r: 8, p: 1 };

function deriveKey(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LEN, WORK_FACTOR, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(derivedKey);
    });
  });
}

async function main() {
  const password = process.argv[2];
  if (!password) {
    console.error('Usage: npm run auth:hash <password>');
    process.exit(1);
  }

  try {
    const salt = crypto.randomBytes(SALT_LEN);
    const key = await deriveKey(password, salt);
    console.log(`scrypt:${salt.toString('base64')}:${key.toString('base64')}`);
  } catch (err) {
    console.error('Failed to hash password:', err);
    process.exit(1);
  }
}

main();
