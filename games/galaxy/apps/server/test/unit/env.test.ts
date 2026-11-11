import { expect, test } from 'vitest';
import { loadEnv } from '../../src/env';

// Fake keys with the real shapes: never real ones in the repo.
const SK = 'sk_live_' + 'a1B2c3D4e5';
const RK = 'rk_live_' + 'f6G7h8I9';
const PK = 'pk_live_' + 'j0K1l2M3';
const WH = 'whsec_' + 'n4O5p6Q7r8';

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

test('sin claves de Stripe la tienda queda cerrada y nada falla', () => {
  const env = loadEnv(base);
  expect(env.stripe).toBeNull();
  expect(env.stripeIssue).toBeNull();
  expect(loadEnv({ ...base, STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', STRIPE_PUBLISHABLE_KEY: '' }).stripe).toBeNull();
});

test('con las tres claves de Stripe del mismo modo, la tienda puede cobrar', () => {
  expect(loadEnv({ ...base, STRIPE_SECRET_KEY: SK, STRIPE_WEBHOOK_SECRET: WH, STRIPE_PUBLISHABLE_KEY: PK }).stripe).toEqual({ secretKey: SK, webhookSecret: WH, publishableKey: PK, mode: 'live' });
  // A restricted key works too.
  expect(loadEnv({ ...base, STRIPE_SECRET_KEY: RK, STRIPE_WEBHOOK_SECRET: WH, STRIPE_PUBLISHABLE_KEY: PK }).stripe?.secretKey).toBe(RK);
});

test.each([
  ['falta una', { STRIPE_SECRET_KEY: SK, STRIPE_PUBLISHABLE_KEY: PK }],
  ['mezclan modos', { STRIPE_SECRET_KEY: SK, STRIPE_WEBHOOK_SECRET: WH, STRIPE_PUBLISHABLE_KEY: PK.replace('live', 'test') }],
  ['la publicable donde va la secreta', { STRIPE_SECRET_KEY: PK, STRIPE_WEBHOOK_SECRET: WH, STRIPE_PUBLISHABLE_KEY: PK }],
  ['un secreto de webhook que no lo es', { STRIPE_SECRET_KEY: SK, STRIPE_WEBHOOK_SECRET: 'otra-cosa', STRIPE_PUBLISHABLE_KEY: PK }],
])('claves de Stripe que no encajan (%s): tienda cerrada con su motivo, sin romper el arranque', (_name, keys) => {
  const env = loadEnv({ ...base, ...keys });
  expect(env.stripe).toBeNull();
  expect(env.stripeIssue).toBe('stripe_env_incomplete');
});
