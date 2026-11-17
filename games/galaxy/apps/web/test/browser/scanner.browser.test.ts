import type { FindsView, GachaView, PulledGalaxy, ShownGalaxy, Tier } from '@galaxy/shared';
import { SHOWCASE_SEEDS, showcaseExample } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { ScannerScreen } from '../../src/scanner/ScannerScreen';
import '../../src/styles/app.css';

// The scanner made attractive (2026-11-17, the owner): the living sky in the monitor, the showcase of what can come
// out, the guarantee's core, the x1/x5/x10 rows and the latest finds, for the deep scanner and an event one, at every
// size we support and at 720 and 1080 high, without the page ever growing sideways (the showcase and the finds move
// inside their own strips). VITE_SCANNER_SHOTS=1 saves the screenshots for the owner.

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});
const shots = !!import.meta.env['VITE_SCANNER_SHOTS'];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const real = (i: number, tier: Tier): PulledGalaxy => {
  const ex = showcaseExample(SHOWCASE_SEEDS[i % 4]!);
  return { ...ex, id: `g${i}`, tier, finish: i % 2 ? 'holo' : 'normal', example: undefined } as PulledGalaxy;
};
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const deep: GachaView = {
  banners: [{ id: 'deep-scan', kind: 'standard', name: 'Escáner profundo', currency: 'signal', nextRates: [0.5, 0.28, 0.13, 0.06, 0.03], sinceLegendary: 12, untilGuarantee: 8, welcome: false }],
  costs: { coins: 100, coinsFive: 475, coinsTen: 900, signals: 1 },
  freePullAvailable: true,
  wallet: { coins: 4200, dust: 860, signal: 12 },
};
const event: GachaView = {
  ...deep,
  freePullAvailable: false,
  banners: [
    ...deep.banners,
    {
      id: 'nova-week',
      kind: 'event',
      name: 'Semana Nova',
      currency: 'signal:nova',
      featured: { trait: 'phenomenon', value: 'supernova' },
      endsAt: '2026-11-24T22:59:00.000Z',
      nextRates: [0.5, 0.28, 0.13, 0.06, 0.03],
      sinceLegendary: 3,
      untilGuarantee: 17,
      welcome: false,
      untilFeatured: 31,
      featuredEvery: 45,
    },
  ],
  wallet: { ...deep.wallet, 'signal:nova': 14 } as GachaView['wallet'],
};
const featured: ShownGalaxy = { ...showcaseExample(SHOWCASE_SEEDS[1]!), featured: true };
const finds: FindsView = {
  recent: [
    { id: 'f1', by: 'vega', at: minutesAgo(2), banner: 'deep-scan', galaxy: real(1, 'legendary') },
    { id: 'f2', by: 'orion_el_cazador', at: minutesAgo(47), banner: 'deep-scan', galaxy: real(2, 'legendary') },
    { id: 'f3', by: 'lyra', at: minutesAgo(190), banner: 'nova-week', galaxy: real(3, 'mythic') },
    { id: 'f4', by: 'sonda_rayo', at: minutesAgo(1500), banner: 'deep-scan', galaxy: real(4, 'legendary') },
  ],
  mine: [real(5, 'legendary'), real(6, 'epic'), real(7, 'epic')],
  showcase: [real(1, 'legendary'), real(2, 'legendary'), ...SHOWCASE_SEEDS.slice(0, 4).map(showcaseExample)],
  featured: { 'nova-week': featured },
};

function mount(view: GachaView, path = '/escaner') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => (url === '/galaxy/api/gacha' ? json(view) : url === '/galaxy/api/gacha/finds' ? json(finds) : json({ error: 'not_found' }, 404))),
  );
  document.body.style.margin = '0';
  const host = document.createElement('div');
  host.style.height = '100vh';
  document.body.appendChild(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(host);
  root.render(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, { initialEntries: [path] }, createElement(Routes, null, createElement(Route, { path: '/escaner', element: createElement(ScannerScreen) })))));
}

const noOverflow = () => {
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  for (const el of document.querySelectorAll<HTMLElement>('.screen-root, .screen-root > :not([aria-hidden="true"]), .scanner-main, .scanner-terminal, .scanner-side, .finds, .pull-row')) {
    expect(el.scrollWidth, el.className).toBeLessThanOrEqual(el.clientWidth + 1);
  }
};

for (const [width, height] of [
  [1280, 720],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
] as const) {
  for (const which of ['profundo', 'evento'] as const) {
    test(`el escáner ${which} a ${width}×${height}: cielo vivo, escaparate, núcleo, x1/x5/x10 y hallazgos, sin desbordes`, { timeout: 90_000 }, async () => {
      await page.viewport(width, height);
      mount(which === 'evento' ? event : deep, which === 'evento' ? '/escaner?tipo=evento' : '/escaner');
      await vi.waitFor(() => expect(document.querySelectorAll('.showcase-item').length).toBe(6), { timeout: 30_000, interval: 200 });
      // Its images load only near the screen: on a short screen the showcase is further down.
      document.querySelector('.showcase')!.scrollIntoView({ block: 'center' });
      await vi.waitFor(() => expect(document.querySelectorAll('.showcase-item article[data-image="ready"]').length).toBeGreaterThan(0), { timeout: 60_000, interval: 200 });
      document.querySelector<HTMLElement>('.collection')!.scrollTop = 0;
      // The sky: 12 blips and the sweep.
      expect(document.querySelectorAll('.radar-blip')).toHaveLength(12);
      expect(document.querySelector('.radar-sweep')).not.toBeNull();
      // Three sizes in each row, «Mejor precio» on the coins' x10 only.
      for (const row of document.querySelectorAll('.pull-row')) expect(row.querySelectorAll('.pull-btn')).toHaveLength(3);
      expect(document.querySelectorAll('.pull-best')).toHaveLength(1);
      expect(document.querySelector('.pity-core')).not.toBeNull();
      // Its glow is not cut at the square's edges (the owner, 2026-11-17).
      expect(getComputedStyle(document.querySelector('.pity-core svg')!).overflow).toBe('visible');
      if (which === 'evento') expect(document.querySelector('.scan-featured-galaxy article')).not.toBeNull();
      // The sky is as tall in both scanners (the owner, 2026-11-17): the screen's height less 470 px, 190 to 620 px.
      const zoom = width >= 2560 ? 1.25 : 1;
      const crt = document.querySelector<HTMLElement>('.scanner-terminal .crt')!.getBoundingClientRect().height;
      expect(crt / zoom).toBeCloseTo(Math.min(620, Math.max(190, height / zoom - 470)), 0);
      noOverflow();
      await new Promise((r) => setTimeout(r, 900));
      if (shots) await page.screenshot({ path: `__shots__/scanner-${which}-${width}.png` });
    });
  }
}
