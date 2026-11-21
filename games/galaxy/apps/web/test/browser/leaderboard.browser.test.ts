import { DEFAULT_CLOSING_TIERS, DEFAULT_PODIUM, type Leaderboard, type LeaderRow } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { LeaderboardScreen } from '../../src/social/LeaderboardScreen';
import '../../src/styles/app.css';

// The leaderboard in a real browser (2026-11-21): the season card that leads to /temporada with your place, your tier
// and the closing prizes, and the General table with its runs and best layer. At every width the page never grows
// sideways, the table fits its panel, and the card's link covers the whole card. VITE_LB_SHOTS=1 saves screenshots.

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const NAMES = ['vega', 'lyra_nova', 'altair', 'deneb', 'rigel_23', 'sirius', 'betelgeuse_x', 'antares', 'polaris', 'capella', 'aldebaran', 'procyon', 'spica', 'arcturus', 'mimosa', 'achernar', 'hadar', 'acrux', 'canopus', 'castor'];
const rows: LeaderRow[] = NAMES.map((username, i) => ({ rank: i + 1, username, level: 30 - i, value: 31_500 - i * 1450, runs: 120 - i * 5, bestDepth: 14 - Math.floor(i / 3), avatar: null, frame: null }));
const me: LeaderRow = { rank: 37, username: 'sonda_rayo', level: 9, value: 2400, runs: 17, bestDepth: 6, avatar: null, frame: null };
const board = (tab: Leaderboard['tab']): Leaderboard => ({
  season: {
    id: 'season-2',
    name: 'Temporada 2',
    startsAt: '2026-11-23T00:00:00.000Z',
    endsAt: new Date(Date.now() + 23 * 86_400_000 + 5 * 3_600_000).toISOString(),
    tiers: [500, 2000, 6000, 15000, 30000],
    closing: { tiers: [...DEFAULT_CLOSING_TIERS], podium: DEFAULT_PODIUM, podiumSize: 3 },
  },
  tab,
  rows,
  me,
  total: 412,
});

function mount(path: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => new Response(JSON.stringify(board(url.endsWith('depth') ? 'depth' : 'general')), { status: 200, headers: { 'content-type': 'application/json' } })),
  );
  const host = document.createElement('div');
  document.body.style.margin = '0';
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    createElement(
      QueryClientProvider,
      { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
      createElement(MemoryRouter, { initialEntries: [path] }, createElement(Routes, null, createElement(Route, { path: '/clasificacion', element: createElement(LeaderboardScreen) }))),
    ),
  );
}

for (const [w, h] of [
  [1280, 720],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
] as const) {
  test(`la clasificación con su temporada a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    mount('/clasificacion');
    await expect.poll(() => document.querySelector('.lb-season .lb-tier-list'), { timeout: 5000 }).toBeTruthy();
    await new Promise((r) => setTimeout(r, 300));
    // Nothing grows sideways: the page, the card and the table's panel.
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    const scroller = document.querySelector<HTMLElement>('.leaderboard-root')!;
    expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth);
    const card = document.querySelector<HTMLElement>('.lb-season')!;
    expect(card.getBoundingClientRect().right).toBeLessThanOrEqual(w);
    expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth + 1);
    const panel = document.querySelector<HTMLElement>('.lb-scroll')!;
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
    // At these widths the General table has room for its runs and best layer.
    const extras = [...document.querySelectorAll<HTMLElement>('.lb-table .lb-extra')];
    expect(extras.length).toBeGreaterThan(0);
    for (const e of extras) expect(getComputedStyle(e).display).not.toBe('none');
    // The link's hit area is the whole card.
    const link = card.querySelector<HTMLElement>('.lb-season-link')!;
    const hit = getComputedStyle(link, '::after');
    expect(hit.position).toBe('absolute');
    const box = card.getBoundingClientRect();
    expect(document.elementFromPoint(box.left + box.width / 2, box.top + 40)?.closest('a')).toBe(link);
    if (import.meta.env['VITE_LB_SHOTS']) {
      await page.screenshot({ path: `__shots__/leaderboard-${w}.png` });
      scroller.scrollTo({ top: scroller.scrollHeight });
      await new Promise((r) => setTimeout(r, 200));
      await page.screenshot({ path: `__shots__/leaderboard-${w}-end.png` });
    }
  });
}

test('con el teclado, la tarjeta de la temporada lleva el anillo de foco entera', async () => {
  await page.viewport(1600, 900);
  mount('/clasificacion');
  await expect.poll(() => document.querySelector('.lb-season-link'), { timeout: 5000 }).toBeTruthy();
  const card = document.querySelector<HTMLElement>('.lb-season')!;
  expect(getComputedStyle(card).outlineStyle).toBe('none');
  // A key first, so the browser treats the focus as the keyboard's (:focus-visible), then straight to the card's link.
  await userEvent.keyboard('{Tab}');
  document.querySelector<HTMLElement>('.lb-season-link')!.focus();
  await expect.poll(() => getComputedStyle(card).outlineStyle).toBe('solid');
  if (import.meta.env['VITE_LB_SHOTS']) await page.screenshot({ path: '__shots__/leaderboard-focus.png' });
});

test('con la columna estrecha, las partidas y la mejor capa se esconden y la tabla no se sale', async () => {
  await page.viewport(960, 720);
  mount('/clasificacion');
  await expect.poll(() => document.querySelector('.lb-table'), { timeout: 5000 }).toBeTruthy();
  const extras = [...document.querySelectorAll<HTMLElement>('.lb-table .lb-extra')];
  expect(extras.length).toBeGreaterThan(0);
  for (const e of extras) expect(getComputedStyle(e).display).toBe('none');
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(960);
  const panel = document.querySelector<HTMLElement>('.lb-scroll')!;
  expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
  if (import.meta.env['VITE_LB_SHOTS']) await page.screenshot({ path: '__shots__/leaderboard-960.png' });
});
