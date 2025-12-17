import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hashPassword, isValidPasswordHash, verifyPassword } from '../src/security/passwords';

describe('password hashing utilities', () => {
  it('hashes and verifies passwords with scrypt', async () => {
    const hash = await hashPassword('CorrectHorse!BatteryStaple1');
    assert.ok(isValidPasswordHash(hash));
    const ok = await verifyPassword('CorrectHorse!BatteryStaple1', hash);
    assert.ok(ok);
  });

  it('fails verification for mismatched password or malformed hash', async () => {
    const hash = await hashPassword('RightPass!234');
    const wrong = await verifyPassword('WrongPass!234', hash);
    assert.equal(wrong, false);

    const malformed = await verifyPassword('whatever', 'not-a-scrypt-hash');
    assert.equal(malformed, false);
  });

  it('guards hash shape before verification', () => {
    assert.equal(isValidPasswordHash(undefined), false);
    assert.equal(isValidPasswordHash(''), false);
    assert.equal(isValidPasswordHash('scrypt:bad'), false);
    assert.equal(isValidPasswordHash('scrypt::::'), false);
  });
});
