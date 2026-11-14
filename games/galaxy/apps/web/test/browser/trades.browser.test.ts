import type { GachaView, MarketRules, MeResponse, MyMarket, MyTradePosts, MyTrades, PublicGalaxy, TradeBoardPage, TradePostView, TradeView } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { MarketScreen } from '../../src/market/MarketScreen';
import '../../src/styles/app.css';

// Trades 2.0 in a real browser (the owner, 2026-11-14: «oro, hasta 3 galaxias por lado, contraofertas»): a trade card
// with two galaxies against one and coins, its history open, and the counter-offer composer with three galaxies a side
// and the coins; at 1280×720 and 1920×1080, nothing sideways. Screenshots with VITE_TRADE_SHOTS=1.

const me: MeResponse = { id: 'a1', username: 'sonda_rayo', roles: [], mfa: false, level: 12 };
const gacha: GachaView = { banners: [], costs: { coins: 100, coinsTen: 900, signals: 1 }, freePullAvailable: false, wallet: { coins: 48_210, dust: 1340, signal: 6 } };
const TIERS = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
const NAMES = ['Orsel', 'Kathra', 'Selem', 'Thaselos', 'Zenreila', 'Vaelith'];
const pub = (i: number): PublicGalaxy => ({
  id: `g${i}`,
  seed: String(9_100_000 + i * 7919),
  tier: TIERS[i % TIERS.length]!,
  finish: i % 4 === 0 ? 'holo' : 'normal',
  traits: {},
  name: `${NAMES[i % NAMES.length]} ${i}`,
  designation: `GX-${(1000 + i).toString(16).toUpperCase()}`,
  featured: false,
  level: 1 + (i % 5),
});
const rules = {
  commission: 0.07,
  minPrice: { common: 50, uncommon: 120, rare: 400, epic: 1500, legendary: 6000, mythic: 15000 },
  mythicListing: false,
  maxPrice: 10_000_000,
  canTrade: true,
  reason: null,
  minLevel: 10,
  minAccountDays: 3,
  listingsLeft: 10,
  purchasesLeft: 10,
  days: 7,
  offers: { enabled: true, hours: 48, openLeft: 10, todayLeft: 30 },
  openTrades: 4,
  tradesLeft: 9,
  tradeDays: 3,
  tradeGalaxies: 3,
} satisfies MarketRules & MyTrades['rules'];
const side = (ids: number[]) => ids.map((i) => ({ id: `g${i}`, name: pub(i).name, tier: pub(i).tier }));
const open: TradeView = {
  id: '00000000-0000-4000-8000-0000000000a1',
  version: 3,
  status: 'open',
  createdAt: '2026-11-14T10:00:00.000Z',
  expiresAt: '2026-11-17T10:00:00.000Z',
  proposedByMe: true,
  me: { galaxies: [pub(3), pub(8)], coins: 0, confirmed: false },
  them: { username: 'lyra', galaxies: [pub(4)], coins: 2500, confirmed: true },
  commission: null,
  post: null,
  history: [
    { version: 1, kind: 'proposed', byMe: true, at: '2026-11-14T10:00:00.000Z', deal: { me: { galaxies: side([3]), coins: 0 }, them: { galaxies: side([4]), coins: 0 } } },
    { version: 2, kind: 'countered', byMe: false, at: '2026-11-14T11:20:00.000Z', deal: { me: { galaxies: side([3, 8]), coins: 0 }, them: { galaxies: side([4]), coins: 0 } } },
    { version: 3, kind: 'countered', byMe: false, at: '2026-11-14T12:05:00.000Z', deal: { me: { galaxies: side([3, 8]), coins: 0 }, them: { galaxies: side([4]), coins: 2500 } } },
    { version: 3, kind: 'confirmed', byMe: false, at: '2026-11-14T12:05:00.000Z', deal: null },
  ],
};
const second: TradeView = {
  ...open,
  id: '00000000-0000-4000-8000-0000000000a2',
  version: 1,
  proposedByMe: false,
  me: { galaxies: [pub(11)], coins: 0, confirmed: false },
  them: { username: 'orion_7', galaxies: [pub(12), pub(13), pub(14)], coins: 0, confirmed: true },
  history: [{ version: 1, kind: 'proposed', byMe: false, at: '2026-11-14T09:00:00.000Z', deal: { me: { galaxies: side([11]), coins: 0 }, them: { galaxies: side([12, 13, 14]), coins: 0 } } }],
};
const trades: MyTrades = { open: [open, second], closed: [], rules };
// The public board (2026-11-14): my post on top, then everyone's.
const boardRules = { canPost: true, openLeft: 2, todayLeft: 4, days: 7, answers: 20 };
const postOf = (i: number, over: Partial<TradePostView>): TradePostView => ({
  id: `00000000-0000-4000-8000-0000000000c${i}`,
  author: ['lyra', 'orion_7', 'deneb', 'vega'][i % 4]!,
  mine: false,
  galaxies: [pub(30 + i)],
  coins: 0,
  wants: { tiers: ['legendary'], coins: false },
  note: '',
  status: 'open',
  createdAt: '2026-11-14T10:00:00.000Z',
  expiresAt: '2026-11-21T10:00:00.000Z',
  answers: i % 3,
  myAnswer: null,
  ...over,
});
const posts: TradePostView[] = [
  postOf(1, { galaxies: [pub(31), pub(32)], wants: { tiers: ['epic', 'legendary'], palette: 'ember', coins: true }, note: 'Busco algo rojo para mi colección de nebulosas' }),
  postOf(2, { galaxies: [], coins: 4000, wants: { tiers: ['legendary'], type: 'spiral', coins: false } }),
  postOf(3, { wants: { tiers: [], coins: false } }),
  postOf(4, { galaxies: [pub(34), pub(35), pub(36)], wants: { tiers: ['rare'], phenomenon: 'quasar', coins: true }, myAnswer: '00000000-0000-4000-8000-0000000000a1' }),
];
const board: TradeBoardPage = { posts, next: 'c1', rules: boardRules };
const myPosts: MyTradePosts = { posts: [postOf(5, { mine: true, author: 'sonda_rayo', galaxies: [pub(40)], wants: { tiers: ['mythic'], coins: true }, answers: 3 })], rules: boardRules };
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
          : url.endsWith('/market/mine')
            ? mine
            : url.endsWith('/market/offers')
              ? { received: [], sent: [], held: 0 }
              : url.endsWith('/trades')
                ? trades
                : url.includes('/trades/board')
                  ? board
                  : url.endsWith('/trades/posts/mine')
                    ? myPosts
                    : url.includes('/galaxies?')
                      ? { items: [pub(50), pub(51), pub(52)], counts: {}, fusion: { count: 5, dust: [] } }
                : url.includes('/profiles/lyra/galaxies')
                  ? { items: [pub(4), pub(5), pub(6), pub(7)], counts: {} }
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
  test(`trueques 2.0 a ${w}×${h}: varias galaxias y monedas por lado, el historial y la contraoferta`, async () => {
    await page.viewport(w, h);
    mount('/mercado?pestana=trueques');
    await expect.poll(() => document.querySelectorAll('.trade-card').length, { timeout: 8000 }).toBe(2);
    // The history of the first one, open.
    await userEvent.click(document.querySelector<HTMLElement>('.trade-card .trade-history summary')!);
    await expect.poll(() => document.querySelector('.trade-card')!.querySelectorAll('.trade-event').length).toBe(4);
    expect(document.querySelector<HTMLDetailsElement>('.trade-card .trade-history')!.open).toBe(true);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    for (const card of document.querySelectorAll('.trade-card')) expect(card.getBoundingClientRect().right).toBeLessThanOrEqual(w);
    await new Promise((r) => setTimeout(r, 600));
    if (import.meta.env['VITE_TRADE_SHOTS']) await page.screenshot({ path: `__shots__/trades-${w}.png` });
    // The counter-offer of the first one, with a third galaxy asked of lyra.
    await userEvent.click(document.querySelector<HTMLButtonElement>('.trade-card .trade-actions button[aria-haspopup="dialog"]')!);
    await expect.poll(() => document.querySelector('.trade-composer .trade-coins input') !== null, { timeout: 8000 }).toBe(true);
    const add = [...document.querySelectorAll<HTMLButtonElement>('.trade-composer .trade-column button[aria-haspopup="dialog"]')].at(-1)!;
    await userEvent.click(add);
    await expect.poll(() => document.querySelectorAll('.relic-picker .gcard-hit').length, { timeout: 8000 }).toBeGreaterThan(0);
    await userEvent.click(document.querySelector<HTMLButtonElement>('.relic-picker .gcard-hit')!);
    await expect.poll(() => document.querySelectorAll('.trade-composer .trade-cards li .gcard, .trade-composer .trade-cards li [class*="gcard"]').length).toBeGreaterThan(2);
    await new Promise((r) => setTimeout(r, 600));
    const modal = document.querySelector('.trade-composer')!.getBoundingClientRect();
    expect(modal.right).toBeLessThanOrEqual(w);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    if (import.meta.env['VITE_TRADE_SHOTS']) await page.screenshot({ path: `__shots__/trades-composer-${w}.png` });
  });

  test(`el tablón a ${w}×${h}: publicaciones, publicar y responder`, async () => {
    await page.viewport(w, h);
    mount('/mercado?pestana=trueques&vista=tablon');
    await expect.poll(() => document.querySelectorAll('.post-card').length, { timeout: 8000 }).toBe(5);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    for (const card of document.querySelectorAll('.post-card')) expect(card.getBoundingClientRect().right).toBeLessThanOrEqual(w);
    await new Promise((r) => setTimeout(r, 600));
    if (import.meta.env['VITE_TRADE_SHOTS']) await page.screenshot({ path: `__shots__/board-${w}.png` });
    // Posting.
    await userEvent.click(document.querySelector<HTMLButtonElement>('.post-bar > button')!);
    await expect.poll(() => document.querySelector('.post-composer textarea') !== null, { timeout: 8000 }).toBe(true);
    await new Promise((r) => setTimeout(r, 400));
    expect(document.querySelector('.post-composer')!.getBoundingClientRect().right).toBeLessThanOrEqual(w);
    if (import.meta.env['VITE_TRADE_SHOTS']) await page.screenshot({ path: `__shots__/board-post-${w}.png` });
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => document.querySelector('.post-composer') === null).toBe(true);
    // Answering the first one.
    await userEvent.click(document.querySelector<HTMLButtonElement>('.post-list:last-of-type .post-foot .pill-solar')!);
    await expect.poll(() => document.querySelector('.trade-composer .post-answer-seeks') !== null, { timeout: 8000 }).toBe(true);
    await new Promise((r) => setTimeout(r, 400));
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    if (import.meta.env['VITE_TRADE_SHOTS']) await page.screenshot({ path: `__shots__/board-answer-${w}.png` });
  });
}
