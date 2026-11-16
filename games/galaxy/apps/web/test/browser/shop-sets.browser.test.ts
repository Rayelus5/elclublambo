import { parseConfig, productTab, purchaseGrants, type ShopProductView, type ShopView } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { ShopScreen } from '../../src/shop/ShopScreen';
import '../../src/styles/app.css';

// Complete skin packs in the Estilo tab (2026-11-17), in a real browser with the app's styles: each card shows its
// eight probes at 48 px (×2 their 24 px) in two rows inside the card, the ones the player has ticked, and the page
// never grows sideways, at three widths. Screenshots for review with VITE_SHOP_SHOTS=1.

const cfg = parseConfig('shop', {});
const now = new Date();
const PROBES = ['lumen', 'bastion', 'spark', 'sentinel', 'anchor', 'prism', 'comet', 'echo'];

function productView(id: string, over: Partial<ShopProductView> = {}): ShopProductView {
  const p = cfg.products.find((x) => x.id === id)!;
  const { base, extra, total } = purchaseGrants(p, now, p.firstBonus, cfg);
  return {
    id: p.id,
    kind: p.kind,
    tab: productTab(p),
    name: p.name,
    art: p.art,
    base,
    bonus: { ...p.bonus },
    extra,
    total,
    priceCents: p.priceCents,
    beforeCents: null,
    offer: null,
    badge: p.badge,
    featured: false,
    first: false,
    maxPerAccount: 1,
    bought: 0,
    block: null,
    cosmetic: p.cosmetic,
    ...over,
  };
}
const set = (line: string, name: string, owned: number, over: Partial<ShopProductView> = {}) =>
  productView('style-skin-lumen', {
    id: `skins-${line}`,
    kind: 'set',
    name,
    cosmetic: null,
    pieces: PROBES.map((p, i) => ({ kind: 'skin' as const, id: `skin-${p}-${line}`, owned: i < owned })),
    owned: owned === PROBES.length,
    priceCents: 1699,
    ...over,
  });

const view: ShopView = {
  open: true,
  closed: null,
  publishableKey: 'pk_live_shots',
  products: [
    set('leyenda', 'Pack Leyenda', 0, { badge: 'limited', availableUntil: '2027-01-06T23:00:00.000Z' }),
    set('aurora', 'Pack Aurora', 3),
    set('coral', 'Pack Coral', 8, { block: 'once_used' }),
    productView('style-skin-prism'),
  ],
  limits: { dailyCents: 10_000, spentTodayCents: 0, pendingMax: 3 },
  firstPurchase: { enabled: true, percent: 100 },
  legal: { seller: '', contact: '', termsVersion: 'v1' },
  wallet: { coins: 1840, dust: 64, signal: 6, components: 22 },
};

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

for (const [w, h] of [
  [1280, 720],
  [1600, 900],
  [1920, 1080],
] as const) {
  test(`packs de skins a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const body = url.endsWith('/gacha') ? { banners: [], wallet: view.wallet, costs: { coins: 100, coinsTen: 900, signals: 1 }, freePullAvailable: false } : view;
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );
    const host = document.createElement('div');
    document.body.style.margin = '0';
    document.body.appendChild(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    root = createRoot(host);
    root.render(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, { initialEntries: ['/tienda?pestana=estilo'] }, createElement(ShopScreen))));
    await expect.poll(() => document.querySelectorAll('.shop-grid .pack-card').length, { timeout: 5000 }).toBe(4);
    const cards = [...document.querySelectorAll<HTMLElement>('.shop-grid .pack-card')].filter((c) => c.querySelector('.set-art'));
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      const box = card.getBoundingClientRect();
      const pieces = [...card.querySelectorAll<HTMLElement>('.set-piece')];
      expect(pieces).toHaveLength(8);
      // Two rows of four, every probe inside its card, drawn at ×2.
      expect(new Set(pieces.map((p) => p.offsetTop)).size).toBe(2);
      for (const p of pieces) {
        const r = p.getBoundingClientRect();
        expect(r.left).toBeGreaterThanOrEqual(box.left);
        expect(r.right).toBeLessThanOrEqual(box.right);
        expect(p.querySelector('img')!.getBoundingClientRect().width).toBe(48);
      }
    }
    expect(cards[1]!.querySelectorAll('.set-piece.owned')).toHaveLength(3);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    if (import.meta.env['VITE_SHOP_SHOTS']) await page.screenshot({ path: `__shots__/shop-sets-${w}.png` });
  }, 60_000);
}
