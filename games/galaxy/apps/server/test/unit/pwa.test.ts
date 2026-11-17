import { describe, expect, test, vi } from 'vitest';
import { offlineCacheName, serviceWorkerSource } from '../../src/pwa';

const OFFLINE_CACHE = offlineCacheName();

// The installable app's service worker (galaxysurvivor.es plan, PR 3), run in a fake worker scope. It only answers the
// game's page loads: the network first and, without it, a small offline page kept when it installed. The API, the
// assets, the sockets and Stripe never go through it. With GALAXY_PWA=off it is a kill switch that removes itself.

type Listener = (event: never) => void;
interface FakeRequest {
  url: string;
  mode: string;
  method: string;
}

function scope(src: string, opts: { online?: boolean; preload?: Response } = {}) {
  const listeners: Record<string, Listener[]> = {};
  const stores = new Map<string, Map<string, Response>>([
    ['gs-offline-v0', new Map()],
    ['otra-cosa', new Map()],
  ]);
  const caches = {
    open: vi.fn(async (name: string) => {
      const store = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, store);
      return {
        addAll: vi.fn(async (urls: string[]) => {
          for (const u of urls) store.set(u, new Response(`cached ${u}`));
        }),
        match: vi.fn(async (u: string) => store.get(u)?.clone()),
      };
    }),
    keys: vi.fn(async () => [...stores.keys()]),
    delete: vi.fn(async (name: string) => stores.delete(name)),
  };
  const windows = [{ url: 'https://galaxysurvivor.es/galaxy/escaner', navigate: vi.fn(async () => null) }];
  const self = {
    location: new URL('https://galaxysurvivor.es/galaxy/sw.js'),
    addEventListener: (type: string, fn: Listener) => (listeners[type] ??= []).push(fn),
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}), matchAll: vi.fn(async () => windows) },
    registration: { navigationPreload: { enable: vi.fn(async () => {}) }, unregister: vi.fn(async () => true) },
  };
  const fetch = vi.fn(async (req: FakeRequest) => {
    if (opts.online === false) throw new TypeError('Failed to fetch');
    return new Response(`network ${req.url}`);
  });
  new Function('self', 'caches', 'fetch', src)(self, caches, fetch);

  /** Fires an extendable event and waits for what it asked to wait for. */
  const lifecycle = async (type: 'install' | 'activate') => {
    const waits: Promise<unknown>[] = [];
    for (const fn of listeners[type] ?? []) fn({ waitUntil: (p: Promise<unknown>) => waits.push(p) } as never);
    await Promise.all(waits);
  };
  /** Fires a fetch event: the response the worker gave, or null when it let the browser handle it. */
  const fetchEvent = async (url: string, mode = 'navigate', method = 'GET'): Promise<Response | null> => {
    let answer: Promise<Response> | null = null;
    const event = { request: { url, mode, method }, preloadResponse: Promise.resolve(opts.preload), respondWith: (p: Promise<Response>) => (answer = p), waitUntil: () => {} };
    for (const fn of listeners['fetch'] ?? []) fn(event as never);
    return answer;
  };
  return { self, caches, stores, windows, fetch, listeners, lifecycle, fetchEvent };
}

const ON = serviceWorkerSource(true);
const OFF = serviceWorkerSource(false);

describe('el worker', () => {
  test('al instalarse guarda la página offline y su hoja de estilo, y no espera', async () => {
    const w = scope(ON);
    await w.lifecycle('install');
    expect([...w.stores.get(OFFLINE_CACHE)!.keys()]).toEqual(['/galaxy/offline.html', '/galaxy/offline.css']);
    expect(w.self.skipWaiting).toHaveBeenCalled();
  });

  test('al activarse borra sus cachés viejas (nunca las ajenas), activa la precarga y toma las pestañas', async () => {
    const w = scope(ON);
    await w.lifecycle('install');
    await w.lifecycle('activate');
    expect([...w.stores.keys()].sort()).toEqual([OFFLINE_CACHE, 'otra-cosa'].sort());
    expect(w.self.registration.navigationPreload.enable).toHaveBeenCalled();
    expect(w.self.clients.claim).toHaveBeenCalled();
  });

  test('una página del juego va a la red primero', async () => {
    const w = scope(ON);
    const res = await w.fetchEvent('https://galaxysurvivor.es/galaxy/escaner');
    expect(await res!.text()).toBe('network https://galaxysurvivor.es/galaxy/escaner');
  });

  test('usa la respuesta precargada cuando la hay', async () => {
    const w = scope(ON, { preload: new Response('preloaded') });
    const res = await w.fetchEvent('https://galaxysurvivor.es/galaxy/');
    expect(await res!.text()).toBe('preloaded');
    expect(w.fetch).not.toHaveBeenCalled();
  });

  test('sin red, una página del juego da la página offline', async () => {
    const w = scope(ON, { online: false });
    await w.lifecycle('install');
    const res = await w.fetchEvent('https://galaxysurvivor.es/galaxy/estacion?x=1');
    expect(await res!.text()).toBe('cached /galaxy/offline.html');
    // And its style sheet, which the offline page asks for.
    const css = await w.fetchEvent('https://galaxysurvivor.es/galaxy/offline.css', 'no-cors');
    expect(await css!.text()).toBe('cached /galaxy/offline.css');
  });

  test('nunca toca la API, los assets, otras rutas, otros orígenes ni lo que no es GET', async () => {
    const w = scope(ON);
    const untouched: [string, string?, string?][] = [
      ['https://galaxysurvivor.es/galaxy/api/me'],
      ['https://galaxysurvivor.es/galaxy/api/shop/webhook', 'navigate', 'POST'],
      ['https://galaxysurvivor.es/galaxy/assets/index-abc.js', 'cors'],
      ['https://galaxysurvivor.es/galaxy/fonts/bungee.woff2', 'cors'],
      ['https://galaxysurvivor.es/galaxy/manifest.webmanifest', 'cors'],
      ['https://galaxysurvivor.es/'],
      ['https://galaxysurvivor.es/privacidad'],
      ['https://galaxysurvivor.es/galaxy'],
      ['https://checkout.stripe.com/c/pay/x'],
      ['https://js.stripe.com/v3', 'no-cors'],
      ['https://galaxysurvivor.es/galaxy/entrar', 'navigate', 'POST'],
    ];
    for (const [url, mode, method] of untouched) expect(await w.fetchEvent(url, mode, method), `${method ?? 'GET'} ${url}`).toBeNull();
    expect(w.fetch).not.toHaveBeenCalled();
  });
});

describe('con GALAXY_PWA=off', () => {
  test('es un interruptor de apagado: borra sus cachés, se desregistra y recarga las pestañas', async () => {
    const w = scope(OFF);
    await w.lifecycle('install');
    expect(w.self.skipWaiting).toHaveBeenCalled();
    await w.lifecycle('activate');
    expect(w.self.registration.unregister).toHaveBeenCalled();
    expect([...w.stores.keys()]).toEqual(['otra-cosa']);
    expect(w.windows[0]!.navigate).toHaveBeenCalledWith('https://galaxysurvivor.es/galaxy/escaner');
    expect(w.listeners['fetch']).toBeUndefined();
  });
});
