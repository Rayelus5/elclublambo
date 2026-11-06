import { expect, test } from 'vitest';
import { isAllowedOrigin } from '../../src/security/origin';

const allowed = ['https://pre.elclub.party', 'http://localhost:5173'];

test.each([
  ['https://pre.elclub.party', true],
  ['http://localhost:5173', true],
  [undefined, false],
  ['', false],
  ['null', false],
  ['https://pre.elclub.party.evil.com', false],
  ['https://evil.com', false],
  ['http://pre.elclub.party', false],
  ['https://pre.elclub.party/', false],
])('origen %s → %s', (origin, ok) => {
  expect(isAllowedOrigin(origin, allowed)).toBe(ok);
});
