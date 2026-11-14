import type { GachaView, GalaxySummary, MarketListing, MarketPage, MarketRules, MarketStats, MeResponse, MyMarket } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { MarketScreen } from '../../src/market/MarketScreen';
import '../../src/styles/app.css';

// The market at scale in a real browser (the owner, 2026-11-14): the wallet in the header, the rarities as chips with
// the search, the order and «Filtros» open, a full page of cards with «Cargar más», the preview of a listing with its 3D
// card and powers, and the numbers; at 1280×720 and 1920×1080, nothing sideways. Screenshots with VITE_MARKET_SHOTS=1.

const me: MeResponse = { id: 'a1', username: 'sonda_rayo', roles: [], mfa: false, level: 12 };
const gacha: GachaView = { banners: [], costs: { coins: 100, coinsTen: 900, signals: 1 }, freePullAvailable: false, wallet: { coins: 48_210, dust: 1340, signal: 6 } };
const TIERS = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
const NAMES = ['Orsel', 'Kathra', 'Selem', 'Thaselos', 'Zenreila', 'Vaelith'];
const galaxy = (i: number): GalaxySummary => ({
  id: `g${i}`,
  seed: String(9_100_000 + i * 7919),
  tier: TIERS[i % TIERS.length]!,
  finish: i % 4 === 0 ? 'holo' : 'normal',
  traits: {},
  name: `${NAMES[i % NAMES.length]} ${i}`,
  designation: `GX-${(1000 + i).toString(16).toUpperCase()}`,
  featured: false,
  level: 1 + (i % 5),
  createdAt: '2026-11-10T10:00:00.000Z',
});
const rules: MarketRules = { commission: 0.07, minPrice: { common: 50, uncommon: 120, rare: 400, epic: 1500, legendary: 6000, mythic: 15000 }, mythicListing: false, maxPrice: 10_000_000, canTrade: true, reason: null, minLevel: 10, minAccountDays: 3, listingsLeft: 10, purchasesLeft: 10, days: 7 };
const listings: MarketListing[] = Array.from({ length: 8 }, (_, i) => ({ id: `l${i}`, galaxy: galaxy(i + 1), seller: ['lyra', 'orion_7', 'deneb'][i % 3]!, price: [600, 1450, 3200, 9800, 15000][i % 5]! + i * 10, listedAt: '2026-11-14T10:00:00.000Z', expiresAt: '2026-11-21T10:00:00.000Z' }));
const stats: MarketStats = {
  updatedAt: '2026-11-14T10:05:00.000Z',
  day: { sales: 12, gold: 34_000, commission: 2380 },
  week: { sales: 80, gold: 250_000, commission: 17_500, trades: 9 },
  active: 1534,
  byTier: { common: { sales: 30, avg: 80 }, rare: { sales: 25, avg: 620 }, epic: { sales: 20, avg: 2100 }, legendary: { sales: 5, avg: 9800 } },
  top: { name: 'Kathra', tier: 'legendary', price: 48_000, at: '2026-11-13T18:00:00.000Z' },
};
const mine: MyMarket = { active: [], sold: [], rules };

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function mount(path: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = url.endsWith('/auth/me')
        ? me
        : url.includes('/gacha')
          ? gacha
          : url.endsWith('/market/stats')
            ? stats
            : url.endsWith('/market/mine')
              ? mine
              : url.includes('/trades')
                ? { trades: [], rules }
                : url.includes('/market?')
                  ? ({ listings, next: 'c1', rules } satisfies MarketPage)
                  : {};
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
  const host = document.createElement('div');
  document.body.style.margin = '0';
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    createElement(
      QueryClientProvider,
      { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
      createElement(MemoryRouter, { initialEntries: [path] }, createElement(Routes, null, createElement(Route, { path: '/mercado', element: createElement(MarketScreen) }))),
    ),
  );
}

for (const [w, h] of [
  [1280, 720],
  [1920, 1080],
] as const) {
  test(`el mercado a ${w}×${h}: filtros, cartas, vista previa y cifras`, async () => {
    await page.viewport(w, h);
    mount('/mercado');
    await expect.poll(() => document.querySelectorAll('.market-card').length, { timeout: 8000 }).toBe(8);
    await userEvent.click(document.querySelector<HTMLButtonElement>('.market-filters-toggle')!);
    await expect.poll(() => document.querySelector('.market-panel') !== null).toBe(true);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    const wallet = document.querySelector<HTMLElement>('.market-wallet')!.getBoundingClientRect();
    expect(wallet.right).toBeLessThanOrEqual(w);
    expect(document.querySelector('.market-more')).not.toBeNull();
    await new Promise((r) => setTimeout(r, 600));
    if (import.meta.env['VITE_MARKET_SHOTS']) await page.screenshot({ path: `__shots__/market-${w}.png` });
    // The preview of a listing.
    await userEvent.click(document.querySelector<HTMLButtonElement>('.market-card-see')!);
    await expect.poll(() => document.querySelector('.relic-sheet .listing-sheet-deal') !== null, { timeout: 8000 }).toBe(true);
    await new Promise((r) => setTimeout(r, 1200));
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    if (import.meta.env['VITE_MARKET_SHOTS']) await page.screenshot({ path: `__shots__/market-sheet-${w}.png` });
  });

  test(`las cifras del mercado a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    mount('/mercado?pestana=estadisticas');
    await expect.poll(() => document.querySelectorAll('.market-stats .stat-tile').length, { timeout: 8000 }).toBe(8);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    if (import.meta.env['VITE_MARKET_SHOTS']) await page.screenshot({ path: `__shots__/market-stats-${w}.png` });
  });
}
