import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { expect, test } from 'vitest';
import { ENGINE_VERSION } from '../src/index';
import { LODS, loadCases, lodOf } from './golden';

// ENGINE_PORT «Versionado»: galaxies that players own must never change. The golden braille of v1 is frozen with this
// hash; if an engine change alters any of it, re-export the goldens into a new folder (golden/v2), bump
// ENGINE_VERSION (the cache keys and the server read it) and pin the new hash here.
const FROZEN = { version: '1.0.0', braille: '7c9c9815ea891cb6063b447f9c6f9259ac82b9094d05b4871ee02402bba4df81' };

test('el motor v1 está congelado', () => {
  const all = loadCases()
    .flatMap((c) => LODS.map((columns) => lodOf(c, columns).braille))
    .join('\n\u0000\n');
  expect({ version: ENGINE_VERSION, braille: bytesToHex(sha256(new TextEncoder().encode(all))) }).toEqual(FROZEN);
});
