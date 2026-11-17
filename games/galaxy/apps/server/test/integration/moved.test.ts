import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { loadEnv } from '../../src/env';
import { CSP } from '../../src/security/headers';
import { TEST_DATABASE_URL, TEST_TOTP_KEY, randomIp, testApp } from '../helpers';

// The move (the owner, 2026-11-17): with the switch on, a browser opening a page of pre.elclub.party/galaxy gets the
// notice «Galaxy Survivor se ha mudado» (built by apps/landing, served here) with its button to the same page on
// galaxysurvivor.es; its stylesheet comes from /galaxy on the old host; crawlers still get the 301; the old host's API
// keeps answering so open tabs finish what they are playing.

const NOTICE = '<!doctype html><title>Galaxy Survivor se ha mudado</title><link rel="stylesheet" href="/galaxy/mudanza.css"><a class="btn" href="{{href}}">Ir a galaxysurvivor.es</a>';
let web: string;
let landing: string;
let ctx: Awaited<ReturnType<typeof testApp>>;

beforeAll(async () => {
  web = mkdtempSync(join(tmpdir(), 'galaxy-moved-web-'));
  writeFileSync(join(web, 'index.html'), '<!doctype html><title>Galaxy Survivor</title><!--gs:head--><div id="root"></div>');
  landing = mkdtempSync(join(tmpdir(), 'galaxy-moved-landing-'));
  mkdirSync(join(landing, 'static'));
  writeFileSync(join(landing, 'index.html'), '<!doctype html><h1>Sobrevive a la Estática</h1>');
  writeFileSync(join(landing, 'moved.html'), NOTICE);
  writeFileSync(join(landing, 'moved.css'), 'body { color: #fff; }');
  writeFileSync(
    join(landing, 'routes.json'),
    JSON.stringify({
      files: [
        { route: '/', file: 'index.html', type: 'text/html; charset=utf-8' },
        { route: null, file: 'moved.html', type: 'text/html; charset=utf-8', role: 'moved' },
        { route: '/galaxy/mudanza.css', file: 'moved.css', type: 'text/css; charset=utf-8' },
      ],
    }),
  );
  const env = loadEnv({
    DATABASE_URL: TEST_DATABASE_URL,
    GALAXY_PUBLIC_ORIGINS: 'https://pre.elclub.party',
    GALAXY_TOTP_KEY: TEST_TOTP_KEY.toString('base64'),
    WEB_DIST: web,
    LANDING_DIST: landing,
    GALAXY_CANONICAL_ORIGIN: 'https://galaxysurvivor.es',
    GALAXY_LEGACY_REDIRECT_FROM: 'pre.elclub.party',
  });
  ctx = await testApp({ env });
});
afterAll(async () => {
  await ctx.close();
  rmSync(web, { recursive: true, force: true });
  rmSync(landing, { recursive: true, force: true });
});

const old = (url: string, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method: 'GET', url, headers: { host: 'pre.elclub.party', 'cf-connecting-ip': randomIp(), ...headers } });

test('un navegador en el host antiguo ve el aviso con el botón a la misma página del dominio nuevo', async () => {
  const res = await old('/galaxy/crear-cuenta?ref=ABC&x=1', { 'sec-fetch-dest': 'document' });
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
  expect(res.headers['cache-control']).toBe('no-store');
  expect(res.headers['x-robots-tag']).toBe('noindex');
  expect(res.headers['content-security-policy']).toBe(CSP);
  expect(res.body).toContain('href="https://galaxysurvivor.es/galaxy/crear-cuenta?ref=ABC&amp;x=1"');
  expect(res.body).not.toContain('{{href}}');
});

test('su hoja de estilo se sirve desde /galaxy en el host antiguo', async () => {
  const css = await old('/galaxy/mudanza.css', { 'sec-fetch-dest': 'style' });
  expect(css.statusCode).toBe(200);
  expect(css.headers['content-type']).toBe('text/css; charset=utf-8');
});

test('un rastreador (sin Sec-Fetch-Dest) recibe el 301 a la misma dirección del dominio nuevo', async () => {
  const res = await old('/galaxy/entrar?ref=x');
  expect(res.statusCode).toBe(301);
  expect(res.headers.location).toBe('https://galaxysurvivor.es/galaxy/entrar?ref=x');
});

test('la API del host antiguo sigue respondiendo: las pestañas abiertas terminan lo que juegan', async () => {
  const res = await old('/galaxy/api/ping', { 'sec-fetch-dest': 'empty' });
  expect(res.statusCode).toBe(204);
});

test('en el dominio nuevo no hay aviso: el juego', async () => {
  const res = await ctx.app.inject({ method: 'GET', url: '/galaxy/entrar', headers: { host: 'galaxysurvivor.es', 'sec-fetch-dest': 'document' } });
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain('<div id="root"></div>');
});
