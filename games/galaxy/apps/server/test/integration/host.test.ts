import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { type AddressInfo, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadEnv } from '../../src/env';
import { CSP } from '../../src/security/headers';
import { TEST_DATABASE_URL, TEST_TOTP_KEY, randomIp, testApp } from '../helpers';

// The game's own domain through the whole app (galaxysurvivor.es plan, PR 1): the env as the container reads it, the
// redirects before the static files and the API, and the new origin accepted by the CSRF guard. With the cutover switch
// empty, the old host serves everything as before.

const INDEX = '<!doctype html><title>Galaxy Survivor</title><div id="root"></div>';
const CANONICAL = 'https://galaxysurvivor.es';
const CRLF = '\r\n';
let dir: string;
let on: Awaited<ReturnType<typeof testApp>>;
let off: Awaited<ReturnType<typeof testApp>>;

/** The env exactly as loadEnv builds it from the container's variables. */
const env = (legacy: string) =>
  loadEnv({
    DATABASE_URL: TEST_DATABASE_URL,
    GALAXY_PUBLIC_ORIGINS: 'http://localhost:5173',
    GALAXY_TOTP_KEY: TEST_TOTP_KEY.toString('base64'),
    WEB_DIST: dir,
    GALAXY_CANONICAL_ORIGIN: CANONICAL,
    GALAXY_LEGACY_REDIRECT_FROM: legacy,
  });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'galaxy-host-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), INDEX);
  writeFileSync(join(dir, 'assets', 'a-1234.js'), 'console.log(1)');
  // apps/web/public's files, outside /galaxy/assets.
  mkdirSync(join(dir, 'fonts'));
  writeFileSync(join(dir, 'fonts', 'bungee-latin.woff2'), 'font');
  writeFileSync(join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  on = await testApp({ env: env('pre.elclub.party') });
  off = await testApp({ env: env('') });
});
afterAll(async () => {
  await on.close();
  await off.close();
  rmSync(dir, { recursive: true, force: true });
});

const page = (ctx: typeof on, host: string, url: string, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method: 'GET', url, headers: { host, 'cf-connecting-ip': randomIp(), ...headers } });

describe('www a la raíz', () => {
  test('www da un 301 al dominio sin www con la ruta, la query, un día de caché y las cabeceras de seguridad', async () => {
    const res = await page(off, 'www.galaxysurvivor.es', '/galaxy/entrar?ref=x');
    expect(res.statusCode).toBe(301);
    expect(res.headers.location).toBe('https://galaxysurvivor.es/galaxy/entrar?ref=x');
    expect(res.headers['cache-control']).toBe('private, max-age=86400');
    expect(res.headers['content-security-policy']).toBe(CSP);
  });

  test('www redirige también lo que no existe, y un POST con un 308', async () => {
    expect((await page(off, 'www.galaxysurvivor.es', '/')).headers.location).toBe('https://galaxysurvivor.es/');
    const res = await off.app.inject({ method: 'POST', url: '/galaxy/api/auth/login', headers: { host: 'www.galaxysurvivor.es', origin: 'https://evil.com' }, payload: {} });
    expect(res.statusCode).toBe(308);
    expect(res.headers.location).toBe('https://galaxysurvivor.es/galaxy/api/auth/login');
  });

  test('una petición de WebSocket a www recibe la redirección y su conexión se cierra (sin sockets colgados)', async () => {
    await off.app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = off.app.server.address() as AddressInfo;
    const result = await new Promise<{ data: string; closed: boolean }>((resolve) => {
      const s = connect(port, '127.0.0.1');
      let data = '';
      const timer = setTimeout(() => {
        s.destroy();
        resolve({ data, closed: false });
      }, 3000);
      s.on('data', (d) => (data += String(d)));
      s.on('close', () => {
        clearTimeout(timer);
        resolve({ data, closed: true });
      });
      s.write(
        ['GET /galaxy/api/live/ws HTTP/1.1', 'Host: www.galaxysurvivor.es', 'Connection: Upgrade', 'Upgrade: websocket', 'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', '', ''].join(CRLF),
      );
    });
    const head = result.data.toLowerCase().split(CRLF);
    expect(head[0]).toMatch(/^http\/1\.1 301 /);
    expect(head).toContain('location: https://galaxysurvivor.es/galaxy/api/live/ws');
    expect(head).toContain('connection: close');
    expect(result.closed).toBe(true);
  });

  test('una ruta que intenta salir de nuestro host acaba en el juego', async () => {
    const res = await page(off, 'www.galaxysurvivor.es', '//evil.com/x');
    expect(res.statusCode).toBe(301);
    expect(res.headers.location).toBe('https://galaxysurvivor.es/galaxy/');
  });
});

describe('el dominio nuevo', () => {
  test('sirve el juego y su API', async () => {
    const shell = await page(on, 'galaxysurvivor.es', '/galaxy/entrar');
    expect(shell.statusCode).toBe(200);
    expect(shell.body).toContain('<title>Entrar | Galaxy Survivor</title>');
    expect(shell.body).toContain('<div id="root"></div>');
    const health = await page(on, 'galaxysurvivor.es', '/galaxy/api/health');
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ ok: true });
  });

  test('su origen pasa la guarda CSRF y uno ajeno no', async () => {
    const login = (origin: string) =>
      on.app.inject({ method: 'POST', url: '/galaxy/api/auth/login', headers: { host: 'galaxysurvivor.es', origin, 'cf-connecting-ip': randomIp() }, payload: {} });
    const ours = await login(CANONICAL);
    expect(ours.statusCode).not.toBe(403);
    expect(ours.json()).not.toEqual({ error: 'origin_rejected' });
    expect((await login('https://www.galaxysurvivor.es')).json()).toEqual({ error: 'origin_rejected' });
    expect((await login('https://evil.com')).json()).toEqual({ error: 'origin_rejected' });
  });
});

describe('el host antiguo', () => {
  test('con el interruptor vacío lo sirve todo como siempre', async () => {
    const shell = await page(off, 'pre.elclub.party', '/galaxy/entrar?ref=x', { 'sec-fetch-dest': 'document' });
    expect(shell.statusCode).toBe(200);
    expect(shell.body).toContain('<title>Entrar | Galaxy Survivor</title>');
    expect(shell.body).toContain('<div id="root"></div>');
    expect((await page(off, 'pre.elclub.party', '/galaxy')).statusCode).toBe(308); // the app's own /galaxy → /galaxy/
    expect((await page(off, 'pre.elclub.party', '/galaxy')).headers.location).toBe('/galaxy/');
  });

  test('con el interruptor puesto, sus páginas van al dominio nuevo con un 301', async () => {
    const res = await page(on, 'pre.elclub.party', '/galaxy/entrar?ref=x', { 'sec-fetch-dest': 'document' });
    expect(res.statusCode).toBe(301);
    expect(res.headers.location).toBe('https://galaxysurvivor.es/galaxy/entrar?ref=x');
    expect(res.headers['cache-control']).toBe('private, max-age=86400');
    expect((await page(on, 'pre.elclub.party', '/galaxy')).headers.location).toBe('https://galaxysurvivor.es/galaxy');
  });

  test('con el interruptor puesto, la API, los assets y lo que no es una página siguen ahí', async () => {
    const health = await page(on, 'pre.elclub.party', '/galaxy/api/health');
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ ok: true });
    const asset = await page(on, 'pre.elclub.party', '/galaxy/assets/a-1234.js', { 'sec-fetch-dest': 'script' });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toBe('console.log(1)');
    const fetched = await page(on, 'pre.elclub.party', '/galaxy/entrar', { 'sec-fetch-dest': 'empty' });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.body).toContain('<div id="root"></div>');
    // The fonts and the favicon (not under /galaxy/assets) stay too, even without Sec-Fetch-Dest (curl, crawlers).
    for (const [url, body] of [['/galaxy/fonts/bungee-latin.woff2', 'font'], ['/galaxy/favicon.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>']] as const) {
      const res = await page(on, 'pre.elclub.party', url);
      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).toBe(body);
    }
    // Stripe's old webhook URL: a POST is never redirected (no signature here, so 503 without a gateway).
    const hook = await on.app.inject({ method: 'POST', url: '/galaxy/api/shop/webhook', headers: { host: 'pre.elclub.party', 'content-type': 'application/json' }, payload: '{}' });
    expect(hook.statusCode).not.toBe(301);
    expect(hook.headers.location).toBeUndefined();
  });
});
