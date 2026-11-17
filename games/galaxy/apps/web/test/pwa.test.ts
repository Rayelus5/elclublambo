import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { routeTitle } from '@galaxy/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getInstall, promptInstall, resetInstall, watchInstall } from '../src/pwa/install';
import { watchPreloadErrors } from '../src/pwa/preload';
import { registerServiceWorker } from '../src/pwa/register';

// The installable app in the web (galaxysurvivor.es plan, PR 3): the browser's install offer kept for the game's own
// button, the worker registered only in a build that has a manifest, and the page reloaded (once a minute at most)
// when a deploy left an open tab asking for chunks that no longer exist.

/** A `beforeinstallprompt` as Chrome and Edge fire it. */
function installOffer(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
  event.prompt = vi.fn(async () => {});
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

/** A matchMedia whose `(display-mode: standalone)` answer can change. */
function displayMode(standalone: boolean) {
  const listeners = new Set<() => void>();
  const list = {
    matches: standalone,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal('matchMedia', (q: string) => (q === '(display-mode: standalone)' ? list : { matches: false, addEventListener() {}, removeEventListener() {} }));
  return {
    set(on: boolean) {
      list.matches = on;
      listeners.forEach((l) => l());
    },
  };
}

describe('la oferta de instalar', () => {
  let stop: () => void = () => {};
  beforeEach(() => resetInstall());
  afterEach(() => {
    stop();
    vi.unstubAllGlobals();
  });

  test('guarda la oferta del navegador (sin su aviso propio) y la usa una vez', async () => {
    displayMode(false);
    stop = watchInstall(window);
    expect(getInstall()).toEqual({ canPrompt: false, standalone: false, installed: false });
    const offer = installOffer();
    window.dispatchEvent(offer);
    expect(offer.defaultPrevented).toBe(true);
    expect(getInstall().canPrompt).toBe(true);
    await expect(promptInstall()).resolves.toBe('accepted');
    expect(offer.prompt).toHaveBeenCalledOnce();
    // An offer is good for one prompt only.
    expect(getInstall().canPrompt).toBe(false);
    await expect(promptInstall()).resolves.toBe('unavailable');
  });

  test('al instalarse lo dice y deja de ofrecerla', () => {
    displayMode(false);
    stop = watchInstall(window);
    window.dispatchEvent(installOffer());
    window.dispatchEvent(new Event('appinstalled'));
    expect(getInstall()).toEqual({ canPrompt: false, standalone: false, installed: true });
  });

  test('sabe si ya se está jugando en la app instalada', () => {
    const mode = displayMode(true);
    stop = watchInstall(window);
    expect(getInstall().standalone).toBe(true);
    mode.set(false);
    expect(getInstall().standalone).toBe(false);
  });
});

describe('la recarga cuando faltan trozos tras un despliegue', () => {
  const at = { now: 1_000_000 };
  let reload: ReturnType<typeof vi.fn<() => void>>;
  let stop: () => void;
  beforeEach(() => {
    sessionStorage.clear();
    reload = vi.fn<() => void>();
    stop = watchPreloadErrors(window, { now: () => at.now, reload });
  });
  afterEach(() => stop());

  const preloadError = () => {
    const e = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(e);
    return e;
  };

  test('recarga una vez, y otra vez solo pasado un minuto', () => {
    const first = preloadError();
    expect(reload).toHaveBeenCalledOnce();
    expect(first.defaultPrevented).toBe(true);
    at.now += 30_000;
    const second = preloadError();
    expect(reload).toHaveBeenCalledOnce();
    // Not swallowed: the error reaches the page as it would without us.
    expect(second.defaultPrevented).toBe(false);
    at.now += 31_000;
    preloadError();
    expect(reload).toHaveBeenCalledTimes(2);
  });

  test('sin sessionStorage no recarga, para no entrar nunca en bucle', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      preloadError();
      expect(reload).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('el registro del worker', () => {
  const sw = () => ({ register: vi.fn(async () => ({}) as ServiceWorkerRegistration) });
  const withManifest = () => {
    const doc = document.implementation.createHTMLDocument('x');
    const link = doc.createElement('link');
    link.rel = 'manifest';
    link.href = '/galaxy/manifest.webmanifest';
    doc.head.append(link);
    return doc;
  };

  test('en producción, con manifest y con soporte, se registra en /galaxy/ sin caché HTTP', async () => {
    const serviceWorker = sw();
    await registerServiceWorker({ prod: true, nav: { serviceWorker } as unknown as Navigator, doc: withManifest() });
    expect(serviceWorker.register).toHaveBeenCalledWith('/galaxy/sw.js', { scope: '/galaxy/', updateViaCache: 'none' });
  });

  test('nunca en desarrollo, sin manifest (el host antiguo) ni sin soporte', async () => {
    const serviceWorker = sw();
    await registerServiceWorker({ prod: false, nav: { serviceWorker } as unknown as Navigator, doc: withManifest() });
    await registerServiceWorker({ prod: true, nav: { serviceWorker } as unknown as Navigator, doc: document.implementation.createHTMLDocument('x') });
    await expect(registerServiceWorker({ prod: true, nav: {} as Navigator, doc: withManifest() })).resolves.toBeNull();
    expect(serviceWorker.register).not.toHaveBeenCalled();
  });

  test('un fallo al registrar no rompe nada', async () => {
    const serviceWorker = { register: vi.fn(async () => Promise.reject(new Error('SecurityError'))) };
    await expect(registerServiceWorker({ prod: true, nav: { serviceWorker } as unknown as Navigator, doc: withManifest() })).resolves.toBeNull();
  });
});

describe('el manifest', () => {
  const pub = join(process.cwd(), 'apps/web/public');
  const manifest = JSON.parse(readFileSync(join(pub, 'manifest.webmanifest'), 'utf8')) as Record<string, unknown> & {
    icons: { src: string; sizes: string; type: string; purpose?: string }[];
    screenshots: { src: string; sizes: string; type: string; form_factor: string; label: string }[];
    shortcuts: { name: string; url: string; icons: { src: string }[] }[];
  };
  const file = (src: string) => join(pub, src.replace(/^\/galaxy\//, ''));

  test('abre el juego en /galaxy/, en su ventana, con los colores del juego', () => {
    expect(manifest).toMatchObject({
      id: '/galaxy/',
      scope: '/galaxy/',
      start_url: '/galaxy/',
      name: 'Galaxy Survivor',
      short_name: 'Galaxy Survivor',
      lang: 'es',
      display: 'standalone',
      orientation: 'landscape',
      background_color: '#070a1c',
      theme_color: '#070a1c',
      categories: ['games'],
      launch_handler: { client_mode: 'focus-existing' },
    });
    // No final full stop and no number an admin can change.
    expect(manifest['description']).toMatch(/^[^.\d]*$/);
  });

  test('sus iconos existen: 192, 512, el maskable y el SVG', () => {
    expect(manifest.icons.map((i) => [i.src, i.sizes, i.purpose ?? 'any'])).toEqual([
      ['/galaxy/icons/icon-192.png', '192x192', 'any'],
      ['/galaxy/icons/icon-512.png', '512x512', 'any'],
      ['/galaxy/icons/maskable-512.png', '512x512', 'maskable'],
      ['/galaxy/favicon.svg', 'any', 'any'],
    ]);
    for (const i of manifest.icons) expect(existsSync(file(i.src)), i.src).toBe(true);
  });

  test('sus capturas son anchas, existen y miden lo que dicen', () => {
    expect(manifest.screenshots.length).toBeGreaterThan(0);
    for (const s of manifest.screenshots) {
      expect(s.form_factor).toBe('wide');
      expect(s.type).toBe('image/webp');
      expect(s.label.length).toBeGreaterThan(0);
      const bytes = readFileSync(file(s.src));
      // A lossy WebP («VP8 »): its frame header carries the size (14 bits each).
      expect(bytes.subarray(12, 16).toString('latin1')).toBe('VP8 ');
      const [w, h] = [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
      expect(`${w}x${h}`, s.src).toBe(s.sizes);
    }
  });

  test('sus atajos llevan a pantallas que existen', () => {
    expect(manifest.shortcuts.map((s) => [s.name, s.url])).toEqual([
      ['Incursión', '/galaxy/incursion'],
      ['Escáner', '/galaxy/escaner'],
      ['Estación', '/galaxy/estacion'],
    ]);
    for (const s of manifest.shortcuts) {
      expect(routeTitle(s.url.replace(/^\/galaxy/, '')), s.url).not.toBeNull();
      for (const i of s.icons) expect(existsSync(file(i.src)), i.src).toBe(true);
    }
  });
});

describe('la página sin conexión', () => {
  const html = readFileSync(join(process.cwd(), 'apps/web/public/offline.html'), 'utf8');

  test('dice «Sin conexión», lleva «Reintentar» al juego y no tiene nada en línea (la CSP)', () => {
    expect(html).toContain('<h1>Sin conexión</h1>');
    expect(html).toMatch(/<a [^>]*href="\/galaxy\/"[^>]*>Reintentar<\/a>/);
    expect(html).toContain('<link rel="stylesheet" href="/galaxy/offline.css">');
    expect(html).not.toMatch(/<script|<style|\sstyle=|\son[a-z]+=/i);
    expect(existsSync(join(process.cwd(), 'apps/web/public/offline.css'))).toBe(true);
  });
});
