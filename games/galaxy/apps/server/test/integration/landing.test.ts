import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { CSP } from '../../src/security/headers';
import { testApp } from '../helpers';

// The landing of galaxysurvivor.es (plan «galaxysurvivor.es», PR 4): its pages at clean paths with the legal data
// filled in, its files, its hashed assets cached for a year, a real 404 page for the rest of the site, and the game's
// own behaviour under /galaxy untouched.

const INDEX = '<!doctype html><title>Galaxy Survivor</title><h1>Sobrevive a la Estática</h1>';
const AVISO = '<!doctype html><title>Aviso legal</title><ul><li data-legal-line="holder">Titular: <!--legal:holder--></li><li data-legal-line="nif">NIF: <!--legal:nif--></li></ul>';
const NOT_FOUND = '<!doctype html><meta name="robots" content="noindex"><title>Página no encontrada</title>';
const SHELL = '<!doctype html><title>Galaxy Survivor</title><div id="root"></div>';
let landing: string;
let web: string;
let ctx: Awaited<ReturnType<typeof testApp>>;

beforeAll(async () => {
  landing = mkdtempSync(join(tmpdir(), 'galaxy-landing-'));
  mkdirSync(join(landing, 'static'));
  mkdirSync(join(landing, '.well-known'));
  writeFileSync(join(landing, 'index.html'), INDEX);
  writeFileSync(join(landing, 'aviso-legal.html'), AVISO);
  writeFileSync(join(landing, '404.html'), NOT_FOUND);
  writeFileSync(join(landing, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  writeFileSync(join(landing, 'sitemap.xml'), '<?xml version="1.0"?><urlset/>');
  writeFileSync(join(landing, '.well-known', 'security.txt'), 'Contact: mailto:x@y.z\n');
  writeFileSync(join(landing, 'favicon.ico'), Buffer.from([0, 0, 1, 0]));
  writeFileSync(join(landing, 'static', 'main-a1.js'), 'console.log(1)');
  writeFileSync(
    join(landing, 'routes.json'),
    JSON.stringify({
      files: [
        { route: '/', file: 'index.html', type: 'text/html; charset=utf-8' },
        { route: '/aviso-legal', file: 'aviso-legal.html', type: 'text/html; charset=utf-8' },
        { route: null, file: '404.html', type: 'text/html; charset=utf-8' },
        { route: '/robots.txt', file: 'robots.txt', type: 'text/plain; charset=utf-8' },
        { route: '/sitemap.xml', file: 'sitemap.xml', type: 'application/xml; charset=utf-8' },
        { route: '/.well-known/security.txt', file: '.well-known/security.txt', type: 'text/plain; charset=utf-8' },
        { route: '/favicon.ico', file: 'favicon.ico', type: 'image/x-icon' },
      ],
    }),
  );
  web = mkdtempSync(join(tmpdir(), 'galaxy-web-'));
  writeFileSync(join(web, 'index.html'), SHELL);
  ctx = await testApp({ env: { LANDING_DIST: landing, WEB_DIST: web, legal: { holder: 'Ana & Co' } } });
});
afterAll(async () => {
  await ctx.close();
  rmSync(landing, { recursive: true, force: true });
  rmSync(web, { recursive: true, force: true });
});

const get = (url: string, headers: Record<string, string> = {}) => ctx.app.inject({ method: 'GET', url, headers });

test('la portada en /: HTML sin caché larga, con la CSP y su ETag', async () => {
  const res = await get('/');
  expect(res.statusCode).toBe(200);
  expect(res.body).toBe(INDEX);
  expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
  expect(res.headers['cache-control']).toBe('no-cache');
  expect(res.headers['content-security-policy']).toBe(CSP);
  const again = await get('/', { 'if-none-match': String(res.headers.etag) });
  expect(again.statusCode).toBe(304);
});

test('las páginas legales, con los datos del titular rellenados y escapados, y sin la línea que falta', async () => {
  const res = await get('/aviso-legal');
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain('Titular: Ana &amp; Co</li>');
  expect(res.body).not.toContain('NIF:');
  expect(res.body).not.toContain('<!--legal:');
});

test('las rutas con .html, index.html o barra final llevan a la limpia', async () => {
  for (const [from, to] of [
    ['/index.html', '/'],
    ['/aviso-legal.html', '/aviso-legal'],
    ['/aviso-legal/', '/aviso-legal'],
    ['/aviso-legal/?x=1', '/aviso-legal?x=1'],
  ]) {
    const res = await get(from!);
    expect(res.statusCode, from).toBe(301);
    expect(res.headers.location, from).toBe(to);
  }
});

test('robots.txt, sitemap.xml, security.txt y el favicon, con su tipo', async () => {
  expect((await get('/robots.txt')).headers['content-type']).toBe('text/plain; charset=utf-8');
  expect((await get('/sitemap.xml')).headers['content-type']).toBe('application/xml; charset=utf-8');
  expect((await get('/.well-known/security.txt')).body).toContain('Contact:');
  const ico = await get('/favicon.ico');
  expect(ico.statusCode).toBe(200);
  expect(ico.headers['content-type']).toBe('image/x-icon');
});

test('los archivos con hash de /static/ se cachean un año', async () => {
  const res = await get('/static/main-a1.js');
  expect(res.statusCode).toBe(200);
  expect(res.body).toBe('console.log(1)');
  expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
});

test('lo que no existe en la web: una página 404 de verdad, sin indexar', async () => {
  for (const url of ['/nada', '/static/no-existe.js', '/a/b/c']) {
    const res = await get(url);
    expect(res.statusCode, url).toBe(404);
    expect(res.headers['content-type'], url).toBe('text/html; charset=utf-8');
    expect(res.body, url).toBe(NOT_FOUND);
  }
});

test('HEAD de la portada responde como GET, sin cuerpo', async () => {
  const res = await ctx.app.inject({ method: 'HEAD', url: '/' });
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
  expect(res.body).toBe('');
});

test('el juego sigue igual: su shell en /galaxy/…, JSON 404 en su API y en lo que no es GET', async () => {
  const shell = await get('/galaxy/entrar');
  expect(shell.statusCode).toBe(200);
  expect(shell.body).toBe(SHELL);
  const api = await get('/galaxy/api/nada');
  expect(api.statusCode).toBe(404);
  expect(api.json()).toEqual({ error: 'not_found' });
  const missing = await get('/galaxy/assets/no-existe.js');
  expect(missing.json()).toEqual({ error: 'not_found' });
  // From an allowed origin, so the CSRF guard lets it through to the not-found answer.
  const post = await ctx.app.inject({ method: 'POST', url: '/nada', payload: {}, headers: { origin: 'http://localhost:5173' } });
  expect(post.statusCode).toBe(404);
  expect(post.json()).toEqual({ error: 'not_found' });
});

test('sin la portada compilada, / sigue siendo el JSON 404 de siempre', async () => {
  const bare = await testApp({ env: { LANDING_DIST: join(landing, 'no-existe') } });
  try {
    const res = await bare.app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  } finally {
    await bare.close();
  }
});
