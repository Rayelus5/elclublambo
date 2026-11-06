import { expect, test } from 'vitest';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../../src/auth/password';

test('argon2id con los parámetros del proyecto', async () => {
  const h = await hashPassword('correcto-caballo');
  expect(h.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
  expect(await verifyPassword(h, 'correcto-caballo')).toBe(true);
  expect(await verifyPassword(h, 'otro-caballo')).toBe(false);
});

test('un hash corrupto no lanza: es una contraseña incorrecta', async () => {
  expect(await verifyPassword('no-es-un-hash', 'lo-que-sea')).toBe(false);
});

test('DUMMY_HASH es un argon2id válido que no coincide con nada razonable', async () => {
  expect(DUMMY_HASH.startsWith('$argon2id$')).toBe(true);
  expect(await verifyPassword(DUMMY_HASH, 'una-clave-larga')).toBe(false);
});
