import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { decryptSecret, encryptSecret, newTotpSecret } from '../../src/auth/totp';

test('cifrado ida y vuelta; con otra clave o el blob tocado falla', () => {
  const k = randomBytes(32);
  const blob = encryptSecret(k, 'JBSWY3DPEHPK3PXP');
  expect(blob.length).toBe(12 + 16 + 'JBSWY3DPEHPK3PXP'.length);
  expect(decryptSecret(k, blob)).toBe('JBSWY3DPEHPK3PXP');
  expect(() => decryptSecret(randomBytes(32), blob)).toThrow();
  const tampered = Buffer.from(blob);
  tampered.writeUInt8(tampered.readUInt8(tampered.length - 1) ^ 1, tampered.length - 1);
  expect(() => decryptSecret(k, tampered)).toThrow();
});

test('dos cifrados del mismo secreto no se parecen (IV aleatorio)', () => {
  const k = randomBytes(32);
  expect(encryptSecret(k, 'JBSWY3DPEHPK3PXP').equals(encryptSecret(k, 'JBSWY3DPEHPK3PXP'))).toBe(false);
});

test('secreto nuevo de 160 bits y URI otpauth con el emisor', () => {
  const s = newTotpSecret();
  expect(s.base32).toMatch(/^[A-Z2-7]{32}$/);
  const uri = new URL(s.uri('rayelus'));
  expect(uri.protocol).toBe('otpauth:');
  expect(uri.host).toBe('totp');
  expect(decodeURIComponent(uri.pathname)).toBe('/Galaxy Survivor:rayelus');
  expect(uri.searchParams.get('issuer')).toBe('Galaxy Survivor');
  expect(uri.searchParams.get('secret')).toBe(s.base32);
  expect(uri.searchParams.get('digits')).toBe('6');
  expect(uri.searchParams.get('period')).toBe('30');
});
