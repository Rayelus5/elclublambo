import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { hashToken, newToken } from '../../src/auth/tokens';

test('token de 32 bytes en base64url y hash sha256', () => {
  const { token, hash } = newToken();
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  expect(hash.equals(createHash('sha256').update(token).digest())).toBe(true);
  expect(hashToken(token).equals(hash)).toBe(true);
});

test('dos tokens nunca coinciden', () => {
  expect(newToken().token).not.toBe(newToken().token);
});
