import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { CSP } from '../../src/security/headers';
import { testApp } from '../helpers';

// The build's index.html as Vite leaves it: the server swaps the title and puts its head at the marker.
const INDEX = '<!doctype html><html lang="es"><head><meta charset="utf-8" /><title>Galaxy Survivor</title><!--gs:head--></head><body><div id="root"></div></body></html>';
/** The shell for a screen: the original document around the head, with that screen's title, never the raw file. */
function expectShell(body: string, title: string) {
  expect(body.startsWith('<!doctype html><html lang="es"><head><meta charset="utf-8" />')).toBe(true);
  expect(body.endsWith('</head><body><div id="root"></div></body></html>')).toBe(true);
  expect(body).toContain(`<title>${title}</title>`);
  expect(body).toContain('<meta name="robots" content="noindex">');
  expect(body).not.toContain('<!--gs:head-->');
  expect(body.match(/<title>/g)).toHaveLength(1);
}
let dir: string;
let ctx: Awaited<ReturnType<typeof testApp>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'galaxy-web-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), INDEX);
  writeFileSync(join(dir, 'assets', 'a-1234.js'), 'console.log(1)');
  writeFileSync(join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  ctx = await testApp({ env: { WEB_DIST: dir } });
});
afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

const get = (url: string) => ctx.app.inject({ method: 'GET', url });

test('/galaxy/ sirve el shell sin caché, con la CSP y sin indexar', async () => {
  const res = await get('/galaxy/');
  expect(res.statusCode).toBe(200);
  expectShell(res.body, 'Galaxy Survivor');
  expect(res.headers['content-type']).toMatch(/text\/html/);
  expect(res.headers['cache-control']).toBe('no-cache');
  expect(res.headers['x-robots-tag']).toBe('noindex');
  expect(res.headers['content-security-policy']).toBe(CSP);
});

test('/galaxy/index.html nunca se sirve tal cual: también es el shell', async () => {
  const res = await get('/galaxy/index.html');
  expect(res.statusCode).toBe(200);
  expectShell(res.body, 'Galaxy Survivor');
  expect(res.headers['x-robots-tag']).toBe('noindex');
});

test('los assets con hash se cachean un año', async () => {
  const res = await get('/galaxy/assets/a-1234.js');
  expect(res.statusCode).toBe(200);
  expect(res.body).toBe('console.log(1)');
  expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
});

test('otros archivos de la raíz se sirven sin caché larga', async () => {
  const res = await get('/galaxy/favicon.svg');
  expect(res.statusCode).toBe(200);
  expect(res.headers['cache-control']).toBe('no-cache');
});

test('fallback de SPA: una ruta de la web devuelve el shell con su título y 200', async () => {
  const cases = [
    ['/galaxy/entrar', 'Entrar | Galaxy Survivor'],
    ['/galaxy/crear-cuenta?x=1', 'Crear cuenta | Galaxy Survivor'],
    ['/galaxy/perfil/vega', 'Perfil | Galaxy Survivor'],
    ['/galaxy/a/b/c', 'Galaxy Survivor'],
  ] as const;
  for (const [url, title] of cases) {
    const res = await get(url);
    expect(res.statusCode, url).toBe(200);
    expectShell(res.body, title);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['x-robots-tag']).toBe('noindex');
  }
});

test('el manifest solo se ofrece en el host canónico; las tarjetas apuntan a él', async () => {
  const canonical = await testApp({ env: { WEB_DIST: dir, GALAXY_CANONICAL_ORIGIN: 'https://galaxysurvivor.es' } });
  try {
    const at = (host: string) => canonical.app.inject({ method: 'GET', url: '/galaxy/crear-cuenta?ref=ABCD', headers: { host } });
    const own = await at('galaxysurvivor.es');
    expect(own.body).toContain('<link rel="manifest" href="/galaxy/manifest.webmanifest">');
    expect(own.body).toContain('<meta property="og:url" content="https://galaxysurvivor.es/galaxy/crear-cuenta?ref=ABCD">');
    const old = await at('pre.elclub.party');
    expect(old.statusCode).toBe(200);
    expect(old.body).not.toContain('rel="manifest"');
    expect(old.body).toContain('<meta property="og:image" content="https://galaxysurvivor.es/og/og-es-v1.jpg">');
  } finally {
    await canonical.close();
  }
  // Without a canonical origin (dev, e2e) every host gets it.
  expect((await get('/galaxy/')).body).toContain('<link rel="manifest" href="/galaxy/manifest.webmanifest">');
});

test('HEAD de una ruta de la web responde como GET (200, html, sin cuerpo)', async () => {
  const res = await ctx.app.inject({ method: 'HEAD', url: '/galaxy/entrar' });
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toMatch(/text\/html/);
  expect(res.body).toBe('');
});

test('un asset que no existe es 404, no el index', async () => {
  const res = await get('/galaxy/assets/no-existe.js');
  expect(res.statusCode).toBe(404);
});

test('la API desconocida sigue siendo 404 JSON', async () => {
  const res = await get('/galaxy/api/nada');
  expect(res.statusCode).toBe(404);
  expect(res.json()).toEqual({ error: 'not_found' });
});

test('/galaxy redirige con 308 a /galaxy/', async () => {
  const res = await get('/galaxy');
  expect(res.statusCode).toBe(308);
  expect(res.headers.location).toBe('/galaxy/');
});

test('con la BD caída y una cookie de sesión, la web se sigue sirviendo (la sesión solo se lee en la API)', async () => {
  const down = await testApp({ env: { WEB_DIST: dir, DATABASE_URL: 'postgresql://galaxy_api:x@127.0.0.1:1/postgres' } });
  try {
    for (const url of ['/galaxy/entrar', '/galaxy/assets/a-1234.js']) {
      const res = await down.app.inject({ method: 'GET', url, headers: { cookie: 'gs_sid=cualquiera' } });
      expect(res.statusCode, url).toBe(200);
    }
  } finally {
    await down.close();
  }
});

test('fuera de /galaxy no se sirve nada', async () => {
  expect((await get('/')).statusCode).toBe(404);
  expect((await get('/index.html')).statusCode).toBe(404);
});

test('no se puede salir del directorio de la web', async () => {
  const res = await get('/galaxy/..%2f..%2fpackage.json');
  expect(res.statusCode === 404 || res.body.includes('<div id="root">')).toBe(true);
  expect(res.body).not.toContain('"name"');
});
