import { DEFAULT_CLOSING_TIERS, DEFAULT_PODIUM, DEFAULT_ROUTE, DEFAULT_SHOP, type Leaderboard, type PastRow, type SeasonResults, type SeasonView } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { SeasonScreen } from '../../src/season/SeasonScreen';
import { LeaderboardScreen } from '../../src/social/LeaderboardScreen';
import '../../src/styles/app.css';

// The past seasons and an admin's preview in a real browser (plan «temporadas como fichas», histórico, 2026-11-22):
// a closed season's final ranking with its card, its numbers and its prizes, the leaderboard of a season still to
// come, and its shop with nothing to press, at four widths. Nothing grows sideways: not the page, not the table's
// panel, not the side cards. VITE_LB_SHOTS=1 saves screenshots (apps/web/test/browser/__shots__/).

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const closing = { tiers: [...DEFAULT_CLOSING_TIERS], podium: DEFAULT_PODIUM, podiumSize: 3 };
const tiers = [500, 2000, 6000, 15000, 30000];
const TIERS = ['stellar', 'platinum', 'gold', 'silver', 'bronze'] as const;
const NAMES = ['vega', 'lyra_nova', 'altair', 'deneb', 'rigel_23', 'sirius', 'betelgeuse_x', 'antares', 'polaris', 'capella', 'aldebaran', 'procyon', 'spica', 'arcturus', 'mimosa', 'achernar', 'hadar', 'acrux', 'canopus', 'castor'];
const rows: PastRow[] = NAMES.map((username, i) => ({ rank: i + 1, username, level: 30 - i, value: 31_500 - i * 1450, tier: TIERS[Math.min(4, Math.floor(i / 4))]!, podium: i < 3, avatar: null, frame: null }));
const T1 = {
  id: 'season-1',
  name: 'Temporada 1',
  startsAt: '2026-11-12T23:00:00.000Z',
  endsAt: '2026-11-22T23:00:00.000Z',
  players: 412,
  podium: [],
  stats: { players: 412, runs: 5320, kills: 1_204_000, cores: 388, extractions: 1900, maxDepth: 17, topSector: 'outer-nebula', topProbe: 'lumen', tiers: { bronze: 200, silver: 120, gold: 60, platinum: 25, stellar: 7 } },
};
const results: SeasonResults = { season: { ...T1, tiers, closing }, rows, me: { rank: 140, username: 'sonda_rayo', level: 9, value: 120, tier: null, podium: false, avatar: null, frame: null }, total: 412, next: 20 };
const T3 = { id: 'season-3', name: 'Temporada 3', startsAt: '2026-12-20T23:00:00.000Z', endsAt: '2027-01-17T23:00:00.000Z', tiers, closing };
const live: Leaderboard = { season: { ...T3, id: 'season-2', name: 'Temporada 2', startsAt: '2026-11-22T23:00:00.000Z', endsAt: new Date(Date.now() + 20 * 86_400_000).toISOString() }, tab: 'general', rows: [], me: null, total: 0 };
const preview: Leaderboard = { season: T3, tab: 'general', rows: [], me: null, total: 0 };
const view: SeasonView = {
  season: { id: 'season-3', name: 'Temporada 3', startsAt: T3.startsAt, endsAt: T3.endsAt, tiers },
  score: 0,
  tier: null,
  currency: { name: 'Esquirlas', balance: 0 },
  steps: DEFAULT_ROUTE.map((s) => ({ ...s, reached: false, claimed: false })),
  shop: DEFAULT_SHOP.map((i) => ({ ...i, bought: 0 })),
  closing: null,
};
const gacha = { wallet: { coins: 12_400, dust: 3_250, signal: 7, material: 40, components: 3 } };

function answer(url: string): { status: number; body: unknown } {
  if (url.endsWith('/auth/me')) return { status: 200, body: { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 } };
  if (url.endsWith('/seasons/history')) return { status: 200, body: { seasons: [T1] } };
  if (url.includes('/seasons/season-1/results')) return { status: 200, body: results };
  if (url.includes('season=season-3')) return { status: 200, body: preview };
  if (url.includes('/leaderboard')) return { status: 200, body: live };
  if (url.includes('/season?preview=season-3')) return { status: 200, body: view };
  if (url.endsWith('/gacha')) return { status: 200, body: gacha };
  return { status: 404, body: { error: 'not_found' } };
}

async function mount(path: string, w: number, h: number) {
  await page.viewport(w, h);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const { status, body } = answer(url);
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
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
      createElement(
        MemoryRouter,
        { initialEntries: [path] },
        createElement(Routes, null, createElement(Route, { path: '/clasificacion', element: createElement(LeaderboardScreen) }), createElement(Route, { path: '/temporada', element: createElement(SeasonScreen) })),
      ),
    ),
  );
}

/** Nothing wider than the screen: the page, its scrolling root and every box named. */
function noSideways(w: number, rootSel: string, boxes: string[]) {
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
  const scroller = document.querySelector<HTMLElement>(rootSel)!;
  expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth);
  for (const sel of boxes) {
    const el = document.querySelector<HTMLElement>(sel);
    expect(el, sel).not.toBeNull();
    expect(el!.getBoundingClientRect().right, sel).toBeLessThanOrEqual(w);
    expect(el!.scrollWidth, sel).toBeLessThanOrEqual(el!.clientWidth + 1);
  }
}

for (const [w, h] of [
  [1280, 720],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
] as const) {
  test(`una temporada pasada en la clasificación a ${w}×${h}`, async () => {
    await mount('/clasificacion?temporada=season-1', w, h);
    await expect.poll(() => document.querySelector('.lb-stats .lb-reached'), { timeout: 5000 }).toBeTruthy();
    await wait(300);
    noSideways(w, '.leaderboard-root', ['.lb-past', '.lb-stats', '.lb-scroll', '.lb-pinned', '.lb-pick']);
    // The tier column has room at these widths, and the selector sits in the head beside the title.
    const tierCells = [...document.querySelectorAll<HTMLElement>('.lb-past-table .lb-past-tier-cell')];
    expect(tierCells.length).toBeGreaterThan(0);
    for (const c of tierCells) expect(getComputedStyle(c).display).not.toBe('none');
    const bar = document.querySelector<HTMLElement>('.leaderboard .collection-bar')!.getBoundingClientRect();
    const pick = document.querySelector<HTMLElement>('.lb-pick')!.getBoundingClientRect();
    expect(pick.top).toBeGreaterThanOrEqual(bar.top - 1);
    expect(pick.bottom).toBeLessThanOrEqual(bar.bottom + 1);
    if (import.meta.env['VITE_LB_SHOTS']) {
      await page.screenshot({ path: `__shots__/leaderboard-past-${w}.png` });
      const scroller = document.querySelector<HTMLElement>('.leaderboard-root')!;
      scroller.scrollTo({ top: scroller.scrollHeight });
      await wait(200);
      await page.screenshot({ path: `__shots__/leaderboard-past-${w}-end.png` });
    }
  });

  test(`la vista previa de la clasificación a ${w}×${h}`, async () => {
    await mount('/clasificacion?temporada=season-3', w, h);
    await expect.poll(() => document.querySelector('.preview-band'), { timeout: 5000 }).toBeTruthy();
    await wait(300);
    noSideways(w, '.leaderboard-root', ['.preview-band', '.lb-season']);
    if (import.meta.env['VITE_LB_SHOTS']) await page.screenshot({ path: `__shots__/leaderboard-preview-${w}.png` });
  });

  test(`la vista previa de la tienda de temporada a ${w}×${h}`, async () => {
    await mount('/temporada?vista=season-3', w, h);
    await expect.poll(() => document.querySelector('.preview-band'), { timeout: 5000 }).toBeTruthy();
    await wait(600);
    noSideways(w, '.missions-root', ['.preview-band']);
    // Nothing to press: every buy button is off.
    const buys = [...document.querySelectorAll<HTMLButtonElement>('.season-shop button')];
    expect(buys.length).toBeGreaterThan(0);
    for (const b of buys) expect(b.disabled).toBe(true);
    if (import.meta.env['VITE_LB_SHOTS']) await page.screenshot({ path: `__shots__/season-preview-${w}.png` });
  }, 60_000);
}
