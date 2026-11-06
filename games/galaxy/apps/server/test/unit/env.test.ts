import { expect, test } from 'vitest';
import { loadEnv } from '../../src/env';

const KEY = Buffer.alloc(32, 1).toString('base64');
const base = {
  DATABASE_URL: 'postgresql://galaxy_api:pw@db:5432/postgres',
  GALAXY_PUBLIC_ORIGINS: 'https://pre.elclub.party, http://localhost:5173',
  GALAXY_TOTP_KEY: KEY,
};

test('lee la configuración con sus valores por defecto', () => {
  const env = loadEnv(base);
  expect(env.DATABASE_URL).toBe(base.DATABASE_URL);
  expect(env.GALAXY_PUBLIC_ORIGINS).toEqual(['https://pre.elclub.party', 'http://localhost:5173']);
  expect(env.GALAXY_TOTP_KEY.equals(Buffer.alloc(32, 1))).toBe(true);
  expect(env.PORT).toBe(8080);
  expect(env.WEB_DIST).toBe('/app/web-dist');
  expect(env.TRUST_CF_IP).toBe(true);
});

test('PORT, WEB_DIST y TRUST_CF_IP se pueden cambiar', () => {
  const env = loadEnv({ ...base, PORT: '9090', WEB_DIST: '/tmp/web', TRUST_CF_IP: 'false' });
  expect(env.PORT).toBe(9090);
  expect(env.WEB_DIST).toBe('/tmp/web');
  expect(env.TRUST_CF_IP).toBe(false);
});

test.each([
  ['sin DATABASE_URL', { ...base, DATABASE_URL: undefined }],
  ['sin orígenes', { ...base, GALAXY_PUBLIC_ORIGINS: '' }],
  ['origen que no es una URL de origen', { ...base, GALAXY_PUBLIC_ORIGINS: 'pre.elclub.party' }],
  ['clave TOTP de 16 bytes', { ...base, GALAXY_TOTP_KEY: Buffer.alloc(16).toString('base64') }],
  ['sin clave TOTP', { ...base, GALAXY_TOTP_KEY: undefined }],
])('falla %s', (_name, src) => {
  expect(() => loadEnv(src)).toThrow();
});
