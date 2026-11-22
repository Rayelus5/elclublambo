import { DEFAULT_ROUTE, DEFAULT_SHOP, type SeasonView } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { SeasonScreen } from '../../src/season/SeasonScreen';
import '../../src/styles/app.css';

// The season screen in a real browser with the app's styles (season shop plan, PR 4): the wallet of Missions with the
// season currency at its end, the time left ticking, the route with «Recoger todo» and the shop marking what you can
// pay, at four widths; the page never grows sideways and the season chip sits inside the wallet. Collecting a step
// flies its chips into the wallet and pops its piece; an expensive purchase asks first. Screenshots for review with
// VITE_SEASON_SHOTS=1 (apps/web/test/browser/__shots__/).

const score = 2300;
const view: SeasonView = {
  season: { id: 'season-2', name: 'Temporada 2', startsAt: '2026-11-22T23:00:00.000Z', endsAt: new Date(Date.now() + 26 * 86_400_000 + 5 * 3_600_000).toISOString(), tiers: [500, 2000, 6000, 15000, 30000] },
  score,
  tier: 'silver',
  currency: { name: 'Esquirlas', balance: 470 },
  steps: DEFAULT_ROUTE.map((s, i) => ({ at: s.at, reward: s.reward, reached: s.at <= score, claimed: i < 4 })),
  shop: DEFAULT_SHOP.map((i) => ({ id: i.id, name: i.name, price: i.price, limit: i.limit, bought: i.id === 'coin-bag' ? i.limit : i.id === 'signal' ? 3 : 0, reward: i.reward })),
  closing: null,
};
const gacha = { banners: [], costs: { coins: 100, coinsFive: 475, coinsTen: 900, signals: 1 }, freePullAvailable: false, wallet: { coins: 18_450, dust: 2310, signal: 7 } };

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mount(w: number, h: number) {
  await page.viewport(w, h);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const claimed = /\/season\/route\/(\d+)\/claim$/.exec(url);
      const body = url.endsWith('/gacha')
        ? gacha
        : claimed && init?.method === 'POST'
          ? { ...view, steps: view.steps.map((s) => (s.at === Number(claimed[1]) ? { ...s, claimed: true } : s)) }
          : view;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
  const host = document.createElement('div');
  document.body.style.margin = '0';
  document.body.appendChild(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(host);
  root.render(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, { initialEntries: ['/temporada'] }, createElement(SeasonScreen))));
  await expect.poll(() => document.querySelector('[data-wallet] .res.shards')).not.toBeNull();
  await wait(900);
}

for (const [w, h] of [
  [1280, 720],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
] as const) {
  test(`temporada a ${w}×${h}`, async () => {
    await mount(w, h);
    const bar = document.querySelector<HTMLElement>('.season-screen .collection-bar')!;
    const wallet = document.querySelector<HTMLElement>('[data-wallet]')!;
    // The wallet stays in its header, on one line with the title and the time left.
    expect(wallet.getBoundingClientRect().right).toBeLessThanOrEqual(bar.getBoundingClientRect().right + 1);
    expect(document.querySelector('.season-left')?.textContent).toMatch(/^Acaba en 26 d/);
    expect(document.querySelectorAll('.season-shop li.affordable')).toHaveLength(3);
    expect(document.querySelectorAll('.season-shop li.short')).toHaveLength(1);
    expect(document.querySelectorAll('.season-shop li.sold')).toHaveLength(1);
    expect(document.querySelector('.season-claim-all')).not.toBeNull();
    // Never sideways.
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    expect(document.querySelector('.missions-root')!.scrollWidth).toBeLessThanOrEqual(w);
    if (import.meta.env['VITE_SEASON_SHOTS']) await page.screenshot({ path: `__shots__/season-${w}.png` });
  }, 60_000);
}

test('recoger un escalón hace volar sus chips a la barra y saca su pieza; una compra cara pregunta', async () => {
  await mount(1600, 900);
  const step = document.querySelector<HTMLButtonElement>('[data-claim="step-2000"]')!;
  step.scrollIntoView({ inline: 'center', block: 'nearest' });
  await wait(300);
  step.click();
  await expect.poll(() => document.querySelectorAll('.claim-chip.signal').length).toBeGreaterThan(0);
  expect(document.querySelector('.claim-piece')?.textContent).toContain('Explorador de la Fisura');
  await wait(380);
  if (import.meta.env['VITE_SEASON_SHOTS']) await page.screenshot({ path: '__shots__/season-flight-1600.png' });
  await wait(2600);
  document.querySelector<HTMLButtonElement>('[data-claim="item-title-hunter"]')!.click();
  await expect.poll(() => document.querySelector('[role="alertdialog"]')).not.toBeNull();
  await wait(400);
  if (import.meta.env['VITE_SEASON_SHOTS']) await page.screenshot({ path: '__shots__/season-confirm-1600.png' });
}, 60_000);
