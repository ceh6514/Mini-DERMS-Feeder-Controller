import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseAuthUsers } from '../src/config';

const validHash =
  'scrypt:xLh0jB75AaU76rkvzo6lQQ==:hYlm2cAHnEsPIOBqLtEkkLw+5sqqp65+hGdd7G5JsMYpuxphfH4waWJGO7OXqkkKYxV//BFqIlSomNBBW2y2Gg==';

describe('auth config parsing', () => {
  it('accepts scrypt password hashes when parsing AUTH_USERS', () => {
    const users = parseAuthUsers(
      JSON.stringify([{ username: 'admin', passwordHash: validHash, role: 'admin' }]),
    );

    assert.equal(users.length, 1);
    assert.equal(users[0].passwordHash, validHash);
    assert.equal(users[0].username, 'admin');
    assert.equal(users[0].role, 'admin');
  });

  it('rejects plaintext passwords with scrypt guidance in the message', () => {
    assert.throws(
      () =>
        parseAuthUsers(JSON.stringify([{ username: 'admin', password: 'pw', role: 'admin' }])),
      /scrypt:<salt>:<derivedKey>/,
    );
  });

  it('rejects malformed hashes with scrypt-specific messaging', () => {
    assert.throws(
      () =>
        parseAuthUsers(
          JSON.stringify([{ username: 'admin', passwordHash: 'not-a-bcrypt-hash', role: 'admin' }]),
        ),
      /valid scrypt hash/,
    );
  });
});
