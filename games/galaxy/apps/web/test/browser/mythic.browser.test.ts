import { renderFromSeed } from '@galaxy/engine';
import type { CollectionPage, Finish, GachaView, GalaxySummary, Tier } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { GalaxyCard } from '../../src/cards/GalaxyCard';
import { CollectionScreen } from '../../src/collection/CollectionScreen';
import { ScannerScreen } from '../../src/scanner/ScannerScreen';
import { ProfileScreen } from '../../src/social/ProfileScreen';
import '../../src/styles/app.css';

// The «Mítica» (plan «rareza Mítica» M1) in a real Chromium: its card is near black in a turning iridescent frame,
// the collection shows its chip and its card, and the scanner its odds, without the page ever growing sideways at
// 1280, 1600, 1920 and 2560. VITE_MYTHIC_SHOTS=1 saves the screenshots for the visual review.
let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const SEEDS = [9_000_017, 9_007_936, 9_015_855, 9_023_774, 9_031_693, 9_039_612, 9_047_531, 9_055_450];
const galaxy = (i: number, tier: Tier, finish: Finish = 'normal'): GalaxySummary => ({
  id: `g${i}`,
  seed: String(SEEDS[i % SEEDS.length]!),
  tier,
  finish,
  traits: renderFromSeed(BigInt(SEEDS[i % SEEDS.length]!), { columns: 48 }).traits as unknown as Record<string, string>,
  name: ['Ónice Vacía', 'Kathra', 'Selem', 'Uxorrei', 'Thaselos', 'Zenreila', 'Orvel', 'Lumbra'][i % 8]!,
  designation: `GX-00${i}B7F`,
  featured: false,
  level: 1 + (i % 4),
  createdAt: '2026-11-13T08:00:00Z',
});

const until = async (check: () => boolean, ms = 60_000) => {
  const start = performance.now();
  while (!check()) {
    if (performance.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const shots = Boolean(import.meta.env['VITE_MYTHIC_SHOTS']);

test('una mítica es casi negra, con un marco que gira por los cuatro tonos y su rareza escrita en ellos', { timeout: 90_000 }, async () => {
  await page.viewport(1560, 760);
  document.body.style.cssText = 'margin:0;background:#070a1c;';
  const host = document.createElement('div');
  host.style.cssText = 'display:flex;flex-wrap:wrap;gap:28px;padding:28px;width:1500px;';
  document.body.append(host);
  const cards = [galaxy(1, 'legendary', 'holo'), galaxy(0, 'mythic', 'holo'), galaxy(2, 'mythic', 'prismatic'), galaxy(3, 'mythic', 'braille'), galaxy(4, 'mythic', 'corrupt')];
  flushSync(() => {
    root = createRoot(host);
    root.render(cards.map((g) => createElement(GalaxyCard, { key: g.id, galaxy: g, size: 220, interactive: true })));
  });
  await until(() => host.querySelectorAll('article[data-image="ready"]').length === cards.length);
  const mythic = host.querySelectorAll<HTMLElement>('.gcard')[1]!;
  const face = mythic.querySelector<HTMLElement>('.gcard-face')!;
  expect(getComputedStyle(face).animationName).toBe('iris-turn');
  expect(getComputedStyle(face).backgroundImage).toMatch(/conic-gradient/);
  expect(getComputedStyle(face, '::before').backgroundImage).toMatch(/radial-gradient/);
  expect(getComputedStyle(mythic.querySelector('.gcard-tier')!).color).toBe('rgba(0, 0, 0, 0)');
  // The frame turns: two moments apart, the gradient's angle moved.
  const angle = () => getComputedStyle(face).getPropertyValue('--iris');
  const before = angle();
  await new Promise((r) => setTimeout(r, 250));
  expect(angle()).not.toBe(before);
  if (shots) {
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: '__shots__/mythic-cards.png', element: host });
  }
});

function mount(path: string, route: string, screen: ReactElement, api: (url: string) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => api(url)));
  document.body.style.margin = '0';
  const host = document.createElement('div');
  host.style.height = '100vh';
  document.body.appendChild(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(host);
  root.render(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, { initialEntries: [path] }, createElement(Routes, null, createElement(Route, { path: route, element: screen })))));
}

const gacha: GachaView = {
  banners: [{ id: 'deep-scan', kind: 'standard', name: 'Escáner profundo', currency: 'signal', nextRates: [0.4998, 0.27986, 0.12993, 0.05997, 0.02999, 0.0005], sinceLegendary: 6, untilGuarantee: 14, welcome: false }],
  costs: { coins: 100, coinsTen: 900, signals: 1 },
  freePullAvailable: true,
  wallet: { coins: 4200, dust: 860, signal: 12 },
};
const collection: CollectionPage = {
  items: [galaxy(0, 'mythic', 'prismatic'), galaxy(1, 'legendary', 'holo'), galaxy(2, 'epic'), galaxy(3, 'rare'), galaxy(4, 'uncommon'), galaxy(5, 'common'), galaxy(6, 'common'), galaxy(7, 'common')],
  counts: { common: 31, uncommon: 12, rare: 6, epic: 3, legendary: 2, mythic: 1 },
  fusion: { count: 5, dust: [20, 50, 120, 300] },
};
const notFound = () => json({ error: 'not_found' }, 404);
const noOverflow = () => {
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  for (const el of document.querySelectorAll<HTMLElement>('.screen-root, .screen-root > *')) expect(el.scrollWidth, el.className).toBeLessThanOrEqual(el.clientWidth + 1);
};

test('en el perfil, el recuento por rareza cabe con su sexta columna', { timeout: 60_000 }, async () => {
  await page.viewport(1280, 720);
  const profile = {
    username: 'vega',
    since: '2026-11-03T10:00:00.000Z',
    level: 17,
    xp: { into: 1240, next: 2000 },
    season: null,
    records: { maxDepth: 9, purges: 12, runs: 40 },
    collection: { total: 55, counts: collection.counts },
    planetarium: { prestige: 31, exhibits: 4, cover: null },
    clan: null,
    title: null,
    avatar: null,
    frame: null,
    banner: null,
    probes: { showcase: [], all: [] },
  };
  mount('/perfil/vega', '/perfil/:username', createElement(ProfileScreen), (url) => (url.endsWith('/profiles/vega') ? json(profile) : notFound()));
  await vi.waitFor(() => expect(document.querySelectorAll('.tier-counts li')).toHaveLength(6), { timeout: 30_000, interval: 200 });
  const list = document.querySelector<HTMLElement>('.tier-counts')!;
  expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth + 1);
  expect(list.querySelector('li[data-tier="mythic"]')!.textContent).toBe('1Mítica');
  if (shots) {
    list.closest<HTMLElement>('.profile-collection')!.scrollIntoView();
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: '__shots__/mythic-profile-counts.png', element: list.closest<HTMLElement>('.profile-collection')! });
  }
});

for (const [width, height] of [
  [1280, 720],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
] as const) {
  test(`la colección con su mítica y el filtro de la sexta rareza a ${width}×${height}`, { timeout: 90_000 }, async () => {
    await page.viewport(width, height);
    mount('/coleccion', '/coleccion', createElement(CollectionScreen), (url) => (url.startsWith('/galaxy/api/galaxies?') ? json(collection) : url === '/galaxy/api/gacha' ? json(gacha) : notFound()));
    await vi.waitFor(() => expect(document.querySelectorAll('article[data-image="ready"]').length).toBe(collection.items.length), { timeout: 60_000, interval: 200 });
    const chip = document.querySelector<HTMLElement>('.chip[data-tier="mythic"]')!;
    expect(chip.textContent).toBe('Mítica1');
    noOverflow();
    await new Promise((r) => setTimeout(r, 400));
    if (shots) await page.screenshot({ path: `__shots__/mythic-collection-${width}.png` });
  });

  test(`el escáner con la probabilidad de mítica a ${width}×${height}`, { timeout: 60_000 }, async () => {
    await page.viewport(width, height);
    mount('/escaner', '/escaner', createElement(ScannerScreen), (url) => (url === '/galaxy/api/gacha' ? json(gacha) : notFound()));
    await vi.waitFor(() => expect(document.querySelector('.odds tr[data-tier="mythic"]')).not.toBeNull(), { timeout: 30_000, interval: 200 });
    expect(document.querySelector('.odds tr[data-tier="mythic"] td')!.textContent).toMatch(/^0,05\s%$/);
    noOverflow();
    await new Promise((r) => setTimeout(r, 400));
    if (shots) await page.screenshot({ path: `__shots__/mythic-scanner-${width}.png` });
  });
}
