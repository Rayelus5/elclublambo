import type { AddressInfo } from 'node:net';
import { connect } from 'node:net';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { describe, expect, test } from 'vitest';
import { type HostRedirectConfig, REDIRECT_CACHE, redirectTarget, registerHostRedirects } from '../../src/security/host';

// The game's own domain (galaxysurvivor.es plan, PR 1): www always goes to the apex, and the old host's page loads go
// to the new one only with the cutover switch on. Chunks, fonts, workers, the API, its sockets and Stripe's webhook stay
// on the old host, so open tabs keep working; nothing may ever send a player to someone else's host.

const CANONICAL = 'https://galaxysurvivor.es';
const ON: HostRedirectConfig = { canonicalOrigin: CANONICAL, legacyHosts: ['pre.elclub.party'] };
const OFF: HostRedirectConfig = { canonicalOrigin: CANONICAL, legacyHosts: [] };

const CRLF = '\r\n';

type Req = Parameters<typeof redirectTarget>[0];
const req = (over: Partial<Req>): Req => ({ method: 'GET', host: 'pre.elclub.party', url: '/galaxy/', secFetchDest: undefined, ...over });

describe('www a la raíz', () => {
  test('www conserva la ruta y la query, con un 301 en GET y HEAD', () => {
    for (const method of ['GET', 'HEAD']) {
      expect(redirectTarget(req({ method, host: 'www.galaxysurvivor.es', url: '/galaxy/entrar?ref=x&y=1' }), OFF)).toEqual({
        status: 301,
        location: 'https://galaxysurvivor.es/galaxy/entrar?ref=x&y=1',
      });
    }
    expect(redirectTarget(req({ host: 'www.galaxysurvivor.es', url: '/' }), OFF)).toEqual({ status: 301, location: 'https://galaxysurvivor.es/' });
  });

  test('www con otro método da un 308, que conserva el método y el cuerpo', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(redirectTarget(req({ method, host: 'www.galaxysurvivor.es', url: '/galaxy/api/auth/login' }), OFF)).toEqual({
        status: 308,
        location: 'https://galaxysurvivor.es/galaxy/api/auth/login',
      });
    }
  });

  test('www redirige también la API, los assets y cualquier destino', () => {
    for (const [url, secFetchDest] of [
      ['/galaxy/api/health', 'empty'],
      ['/galaxy/assets/a-1234.js', 'script'],
      ['/robots.txt', undefined],
    ] as const) {
      expect(redirectTarget(req({ host: 'www.galaxysurvivor.es', url, secFetchDest }), OFF)?.location).toBe(CANONICAL + url);
    }
  });

  test('el host se compara sin puerto y sin mayúsculas', () => {
    for (const host of ['WWW.GalaxySurvivor.ES', 'www.galaxysurvivor.es:443', 'www.galaxysurvivor.es.']) {
      expect(redirectTarget(req({ host, url: '/galaxy/' }), OFF)?.location, host).toBe('https://galaxysurvivor.es/galaxy/');
    }
  });
});

describe('host antiguo al nuevo, con el interruptor puesto', () => {
  test('una página del juego da un 301 a la misma ruta y query del dominio nuevo', () => {
    expect(redirectTarget(req({ url: '/galaxy/entrar?ref=x' }), ON)).toEqual({ status: 301, location: 'https://galaxysurvivor.es/galaxy/entrar?ref=x' });
    expect(redirectTarget(req({ url: '/galaxy/tienda?compra=abc', secFetchDest: 'document' }), ON)?.location).toBe('https://galaxysurvivor.es/galaxy/tienda?compra=abc');
    expect(redirectTarget(req({ method: 'HEAD', url: '/galaxy/' }), ON)).toEqual({ status: 301, location: 'https://galaxysurvivor.es/galaxy/' });
  });

  test('/galaxy a secas también', () => {
    expect(redirectTarget(req({ url: '/galaxy' }), ON)).toEqual({ status: 301, location: 'https://galaxysurvivor.es/galaxy' });
    expect(redirectTarget(req({ url: '/galaxy?ref=x' }), ON)?.location).toBe('https://galaxysurvivor.es/galaxy?ref=x');
  });

  test('el host antiguo se compara sin puerto y sin mayúsculas', () => {
    expect(redirectTarget(req({ host: 'PRE.elclub.party:443', url: '/galaxy/' }), ON)?.location).toBe('https://galaxysurvivor.es/galaxy/');
  });

  test('la API y los assets no se redirigen: las pestañas abiertas siguen funcionando', () => {
    for (const url of ['/galaxy/api/health', '/galaxy/api', '/galaxy/api/shop/webhook', '/galaxy/assets/a-1234.js', '/galaxy/assets']) {
      expect(redirectTarget(req({ url }), ON), url).toBeNull();
    }
  });

  test('los archivos de la web fuera de /galaxy/assets no se redirigen, aunque falte Sec-Fetch-Dest (curl, rastreadores)', () => {
    // apps/web/public: the fonts and the favicon. Only the SPA's routes (no file extension) move.
    for (const url of ['/galaxy/fonts/bungee-latin.woff2', '/galaxy/fonts/OFL-Bungee.txt', '/galaxy/favicon.svg', '/galaxy/index.html', '/galaxy/favicon.svg?v=2']) {
      expect(redirectTarget(req({ url }), ON), url).toBeNull();
      expect(redirectTarget(req({ url, secFetchDest: 'document' }), ON), url).toBeNull();
    }
  });

  test('las rutas de la web, con parámetros o query, sí se redirigen', () => {
    for (const url of ['/galaxy/coleccion/0b6c7a52-3f1e-4c55-9d4b-1f2e3d4c5b6a', '/galaxy/incursion?modo=grupo', '/galaxy/perfil/rayelus_5', '/galaxy/tienda/?compra=x.y']) {
      expect(redirectTarget(req({ url }), ON)?.location, url).toBe(CANONICAL + url);
    }
  });

  test('lo que no es una página (Sec-Fetch-Dest) no se redirige', () => {
    for (const secFetchDest of ['script', 'font', 'worker', 'serviceworker', 'style', 'image', 'manifest', 'empty', 'iframe']) {
      expect(redirectTarget(req({ url: '/galaxy/entrar', secFetchDest }), ON), secFetchDest).toBeNull();
    }
  });

  test('solo GET y HEAD: un POST al host antiguo sigue ahí (el webhook de Stripe y la API)', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(redirectTarget(req({ method, url: '/galaxy/entrar' }), ON), method).toBeNull();
    }
  });

  test('fuera de /galaxy no se toca nada', () => {
    for (const url of ['/', '/foro', '/galaxyfoo', '/galaxy-x/', '/api/galaxy/']) {
      expect(redirectTarget(req({ url }), ON), url).toBeNull();
    }
  });

  test('con el interruptor vacío el host antiguo no se redirige', () => {
    expect(redirectTarget(req({ url: '/galaxy/entrar?ref=x' }), OFF)).toBeNull();
    expect(redirectTarget(req({ url: '/galaxy' }), OFF)).toBeNull();
  });
});

describe('lo demás queda igual', () => {
  test('el dominio nuevo, otros hosts y la falta de host no se redirigen', () => {
    for (const host of ['galaxysurvivor.es', 'GalaxySurvivor.es:443', 'localhost:8080', '127.0.0.1:8080', 'evil.com', 'www.evil.com', 'www.pre.elclub.party', 'xwww.galaxysurvivor.es', undefined]) {
      expect(redirectTarget(req({ host, url: '/galaxy/entrar' }), ON), String(host)).toBeNull();
    }
  });

  test('sin origen canónico no hay ninguna redirección', () => {
    const none: HostRedirectConfig = { canonicalOrigin: null, legacyHosts: ['pre.elclub.party'] };
    expect(redirectTarget(req({ url: '/galaxy/entrar' }), none)).toBeNull();
    expect(redirectTarget(req({ host: 'www.galaxysurvivor.es', url: '/galaxy/' }), none)).toBeNull();
  });

  test('el propio dominio nuevo en el interruptor nunca hace un bucle', () => {
    const loop: HostRedirectConfig = { canonicalOrigin: CANONICAL, legacyHosts: ['galaxysurvivor.es', 'pre.elclub.party'] };
    expect(redirectTarget(req({ host: 'galaxysurvivor.es', url: '/galaxy/entrar' }), loop)).toBeNull();
  });
});

describe('nunca sale del dominio nuevo', () => {
  const evil = ['//evil.com', '//evil.com/galaxy/', '/\\evil.com', '/\\/evil.com/x', 'http://evil.com/galaxy/', 'https://evil.com', '@evil.com/x', 'evil.com/galaxy', 'javascript:alert(1)'];

  test.each(evil)('www con %s va a la portada del juego en nuestro host', (url) => {
    const r = redirectTarget(req({ host: 'www.galaxysurvivor.es', url }), ON);
    expect(r).not.toBeNull();
    expect(new URL(r!.location).origin).toBe(CANONICAL);
    expect(r!.location).toBe('https://galaxysurvivor.es/galaxy/');
  });

  test.each(evil)('el host antiguo con %s no se redirige o se queda en nuestro host', (url) => {
    const r = redirectTarget(req({ url }), ON);
    if (r) expect(new URL(r.location).origin).toBe(CANONICAL);
  });

  test('rutas raras bajo /galaxy se quedan en nuestro host', () => {
    // Without a dot they look like web routes and are redirected; with one (`evil.com`) they look like files and stay.
    for (const url of ['/galaxy/..//evil', '/galaxy/../\\evil', '/galaxy/%2F%2Fevil', '/galaxy/@evil', '/galaxy/..//evil.com/x']) {
      const r = redirectTarget(req({ url }), ON);
      expect(r, url).not.toBeNull();
      expect(new URL(r!.location).origin, url).toBe(CANONICAL);
    }
    for (const url of ['/galaxy/..//evil.com', '/galaxy/../\\evil.com', '/galaxy/%2F%2Fevil.com', '/galaxy/@evil.com']) {
      expect(redirectTarget(req({ url }), ON), url).toBeNull();
    }
    // Not a /galaxy path for the old host; www keeps it on our host.
    expect(redirectTarget(req({ url: '/galaxy\\@evil.com' }), ON)).toBeNull();
    expect(new URL(redirectTarget(req({ host: 'www.galaxysurvivor.es', url: '/galaxy\\@evil.com' }), ON)!.location).origin).toBe(CANONICAL);
  });
});

describe('el hook en la raíz', () => {
  async function app(cfg: HostRedirectConfig) {
    const a = Fastify();
    registerHostRedirects(a, cfg);
    a.get('/galaxy/', async () => 'shell');
    a.post('/galaxy/api/thing', async () => ({ ok: true }));
    await a.ready();
    return a;
  }

  test('responde la redirección con Cache-Control de un día, también en rutas que no existen', async () => {
    const a = await app(ON);
    const www = await a.inject({ method: 'GET', url: '/?a=1', headers: { host: 'www.galaxysurvivor.es' } });
    expect(www.statusCode).toBe(301);
    expect(www.headers.location).toBe('https://galaxysurvivor.es/?a=1');
    expect(www.headers['cache-control']).toBe(REDIRECT_CACHE);
    // private: Cloudflare caches a 301 on a static extension by its URL alone; the edge must never keep ours.
    expect(REDIRECT_CACHE).toBe('private, max-age=86400');
    const post = await a.inject({ method: 'POST', url: '/galaxy/api/thing', headers: { host: 'www.galaxysurvivor.es' }, payload: { x: 1 } });
    expect(post.statusCode).toBe(308);
    expect(post.headers.location).toBe('https://galaxysurvivor.es/galaxy/api/thing');
    const legacy = await a.inject({ method: 'GET', url: '/galaxy/entrar?ref=x', headers: { host: 'pre.elclub.party', 'sec-fetch-dest': 'document' } });
    expect(legacy.statusCode).toBe(301);
    expect(legacy.headers.location).toBe('https://galaxysurvivor.es/galaxy/entrar?ref=x');
    expect(legacy.headers['cache-control']).toBe(REDIRECT_CACHE);
    const evil = await a.inject({ method: 'GET', url: '//evil.com/x', headers: { host: 'www.galaxysurvivor.es' } });
    expect(evil.statusCode).toBe(301);
    expect(evil.headers.location).toBe('https://galaxysurvivor.es/galaxy/');
    await a.close();
  });

  test('lo que no se redirige llega a su ruta como siempre', async () => {
    const a = await app(ON);
    expect((await a.inject({ method: 'GET', url: '/galaxy/', headers: { host: 'galaxysurvivor.es' } })).body).toBe('shell');
    expect((await a.inject({ method: 'GET', url: '/galaxy/', headers: { host: 'pre.elclub.party', 'sec-fetch-dest': 'script' } })).body).toBe('shell');
    expect((await a.inject({ method: 'POST', url: '/galaxy/api/thing', headers: { host: 'pre.elclub.party' }, payload: {} })).json()).toEqual({ ok: true });
    await a.close();
  });

  test('una petición de WebSocket a www recibe la redirección y su conexión se cierra', async () => {
    // As in app.ts: after @fastify/websocket, whose own hooks mark the upgrade and destroy its socket after the reply.
    const a = Fastify();
    await a.register(websocket);
    registerHostRedirects(a, ON);
    a.get('/galaxy/api/live/ws', { websocket: true }, (socket) => socket.close());
    await a.listen({ host: '127.0.0.1', port: 0 });
    const { port } = a.server.address() as AddressInfo;
    const result = await new Promise<{ data: string; closed: boolean }>((resolve) => {
      const s = connect(port, '127.0.0.1');
      let data = '';
      const timer = setTimeout(() => {
        s.destroy();
        resolve({ data, closed: false });
      }, 2000);
      s.on('data', (d) => (data += String(d)));
      s.on('close', () => {
        clearTimeout(timer);
        resolve({ data, closed: true });
      });
      s.write(
        ['GET /galaxy/api/live/ws HTTP/1.1', 'Host: www.galaxysurvivor.es', 'Connection: Upgrade', 'Upgrade: websocket', 'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', '', ''].join(CRLF),
      );
    });
    await a.close();
    const head = result.data.toLowerCase().split(CRLF);
    expect(head[0]).toMatch(/^http\/1\.1 301 /);
    expect(head).toContain('location: https://galaxysurvivor.es/galaxy/api/live/ws');
    expect(head).toContain('connection: close');
    expect(result.closed).toBe(true);
  });

  test('sin origen canónico el hook ni se registra', async () => {
    const a = await app({ canonicalOrigin: null, legacyHosts: ['pre.elclub.party'] });
    const res = await a.inject({ method: 'GET', url: '/galaxy/', headers: { host: 'www.galaxysurvivor.es' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('shell');
    await a.close();
  });
});

// The move (the owner, 2026-11-17: «que se muestre un popup únicamente diciendo que el dominio se ha renovado»): a
// browser opening a page of the old host gets the notice with its button to the same page on the new domain; crawlers
// and tools (no Sec-Fetch-Dest) still get the 301, so the search engines move the old addresses over.
describe('la mudanza: el aviso en el host antiguo', () => {
  test('un navegador que abre una página del host antiguo recibe el aviso; un rastreador, el 301 de siempre', () => {
    expect(redirectTarget(req({ url: '/galaxy/entrar?ref=x', secFetchDest: 'document' }), ON)).toEqual({ status: 301, location: 'https://galaxysurvivor.es/galaxy/entrar?ref=x', notice: true });
    expect(redirectTarget(req({ url: '/galaxy/entrar?ref=x' }), ON)).toEqual({ status: 301, location: 'https://galaxysurvivor.es/galaxy/entrar?ref=x' });
  });

  test('www nunca enseña el aviso: es el mismo sitio y va directo', () => {
    expect(redirectTarget(req({ host: 'www.galaxysurvivor.es', url: '/galaxy/', secFetchDest: 'document' }), ON)).toEqual({ status: 301, location: 'https://galaxysurvivor.es/galaxy/' });
  });

  const NOTICE = (href: string) => `<!doctype html><title>Galaxy Survivor se ha mudado</title><a href="${href.replace(/&/g, '&amp;')}">Ir</a>`;

  test('el hook sirve el aviso con un 200, sin caché y sin indexar; HEAD sin cuerpo', async () => {
    const app = Fastify();
    registerHostRedirects(app, { ...ON, notice: NOTICE });
    app.get('/galaxy/*', async () => 'game');
    const res = await app.inject({ method: 'GET', url: '/galaxy/entrar?ref=a&b=2', headers: { host: 'pre.elclub.party', 'sec-fetch-dest': 'document' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-robots-tag']).toBe('noindex');
    expect(res.body).toContain('href="https://galaxysurvivor.es/galaxy/entrar?ref=a&amp;b=2"');
    const head = await app.inject({ method: 'HEAD', url: '/galaxy/', headers: { host: 'pre.elclub.party', 'sec-fetch-dest': 'document' } });
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe('');
    await app.close();
  });

  test('sin aviso compilado, el navegador recibe el 301 igualmente', async () => {
    const app = Fastify();
    registerHostRedirects(app, { ...ON, notice: () => null });
    const res = await app.inject({ method: 'GET', url: '/galaxy/entrar', headers: { host: 'pre.elclub.party', 'sec-fetch-dest': 'document' } });
    expect(res.statusCode).toBe(301);
    expect(res.headers.location).toBe('https://galaxysurvivor.es/galaxy/entrar');
    await app.close();
  });

  test('el aviso no toca la API ni los archivos del host antiguo: las pestañas abiertas terminan lo que juegan', async () => {
    const app = Fastify();
    registerHostRedirects(app, { ...ON, notice: NOTICE });
    app.get('/galaxy/api/health', async () => ({ ok: true }));
    app.get('/galaxy/fonts/bungee-latin.woff2', async () => 'font');
    const api = await app.inject({ method: 'GET', url: '/galaxy/api/health', headers: { host: 'pre.elclub.party', 'sec-fetch-dest': 'empty' } });
    expect(api.json()).toEqual({ ok: true });
    const font = await app.inject({ method: 'GET', url: '/galaxy/fonts/bungee-latin.woff2', headers: { host: 'pre.elclub.party', 'sec-fetch-dest': 'font' } });
    expect(font.body).toBe('font');
    await app.close();
  });
});
