import { installable } from './install';

// The installable app's service worker (galaxysurvivor.es plan, PR 3), served by the server at /galaxy/sw.js. Only a
// production build registers it, and only on a page that links the manifest: the server links it on the game's own
// host alone, so pre.elclub.party (and a server with GALAXY_PWA=off) never gets a worker. `updateViaCache: 'none'`
// checks the worker on every page load, so an update or the kill switch reaches everyone at once.

export interface RegisterOptions {
  prod?: boolean;
  nav?: Navigator;
  doc?: Document;
}

/** Registers the worker when it applies; null when it does not (or the browser said no). Never throws. */
export async function registerServiceWorker(opts: RegisterOptions = {}): Promise<ServiceWorkerRegistration | null> {
  const prod = opts.prod ?? import.meta.env.PROD;
  const nav = opts.nav ?? navigator;
  const doc = opts.doc ?? document;
  if (!prod || !('serviceWorker' in nav) || !installable(doc)) return null;
  try {
    return await nav.serviceWorker.register('/galaxy/sw.js', { scope: '/galaxy/', updateViaCache: 'none' });
  } catch {
    return null;
  }
}
