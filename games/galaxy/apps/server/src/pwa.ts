import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

// The installable app (galaxysurvivor.es plan, PR 3; GDD §18.1): the service worker the web registers at
// /galaxy/sw.js, served by the server so GALAXY_PWA can switch it off without a new build. It is minimal on purpose:
// it only answers the game's own page loads (network first, so every update arrives at once; without a network, a small
// offline page kept when it installed). It never touches the API, the hashed assets, the sockets or Stripe, and keeps
// no copy of the shell. With GALAXY_PWA=off it becomes a kill switch: it clears its caches, unregisters itself and
// reloads the tabs it controlled, which then load straight from the network.

/** The offline page and its style sheet (apps/web/public), kept by the worker when it installs. */
const OFFLINE_FILES = ['offline.html', 'offline.css'] as const;
/** Every cache of ours starts with this; the worker never deletes anyone else's (the landing shares the origin). */
const CACHE_PREFIX = 'gs-offline-';

/** The name of the offline cache for a version of the offline files. */
export function offlineCacheName(version = 'v1'): string {
  return CACHE_PREFIX + version;
}

/** The worker's whole source: the real one, or (`enabled` false) the kill switch. `version` names its cache. */
export function serviceWorkerSource(enabled: boolean, version = 'v1'): string {
  if (!enabled) {
    return `// Galaxy Survivor: the installable app is off (GALAXY_PWA=off). This worker removes itself and reloads its tabs.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(${JSON.stringify(CACHE_PREFIX)})).map((k) => caches.delete(k)));
    await self.registration.unregister();
    const tabs = await self.clients.matchAll({ type: 'window' });
    await Promise.all(tabs.map((tab) => tab.navigate(tab.url)));
  })());
});
`;
  }
  const files = OFFLINE_FILES.map((f) => `/galaxy/${f}`);
  return `// Galaxy Survivor's service worker: the game's page loads go to the network first; without it, the offline page.
// The API, the assets, the sockets and Stripe never go through here.
const CACHE = ${JSON.stringify(offlineCacheName(version))};
const OFFLINE = ${JSON.stringify(files[0])};
const OFFLINE_CSS = ${JSON.stringify(files[1])};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([OFFLINE, OFFLINE_CSS])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(${JSON.stringify(CACHE_PREFIX)}) && k !== CACHE).map((k) => caches.delete(k)));
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === OFFLINE_CSS) {
    event.respondWith(fetch(request).catch(() => caches.open(CACHE).then((cache) => cache.match(OFFLINE_CSS)).then((r) => r || Response.error())));
    return;
  }
  if (request.mode !== 'navigate' || !url.pathname.startsWith('/galaxy/') || url.pathname.startsWith('/galaxy/api/')) return;
  event.respondWith((async () => {
    try {
      const preloaded = await event.preloadResponse;
      if (preloaded) return preloaded;
      return await fetch(request);
    } catch {
      const offline = await caches.open(CACHE).then((cache) => cache.match(OFFLINE));
      return offline || Response.error();
    }
  })());
});
`;
}

/** A short hash of the offline files as built, so a new offline page gets a new cache (and a new worker). */
function offlineVersion(webDist: string): string {
  const hash = createHash('sha1');
  for (const f of OFFLINE_FILES) {
    const path = join(webDist, f);
    hash.update(existsSync(path) ? readFileSync(path) : f);
  }
  return hash.digest('hex').slice(0, 10);
}

/**
 * GET /galaxy/sw.js: the worker (or its kill switch), as JavaScript revalidated on every check, so an update or the
 * switch reaches every player on their next page load. Its scope is /galaxy/, where it lives.
 */
export function registerPwa(app: FastifyInstance, opts: { enabled: boolean; webDist: string }): void {
  const source = serviceWorkerSource(opts.enabled, offlineVersion(opts.webDist));
  app.get('/galaxy/sw.js', (_req, reply) => reply.header('cache-control', 'no-cache').type('text/javascript; charset=utf-8').send(source));
}
