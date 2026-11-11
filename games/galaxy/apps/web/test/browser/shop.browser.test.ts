import { DEFAULT_SHOP_PRODUCTS, parseConfig, productTab, purchaseGrants, type ShopProductView, type ShopView } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { ShopScreen } from '../../src/shop/ShopScreen';
import '../../src/styles/app.css';

// The resource shop in a real browser with the app's styles (shop and lab plan, F5): the featured offer, the welcome
// pack and the first purchase's card, a tab of six packs drawn with their sprites, at four widths; the page never
// grows sideways. Screenshots
// for review with VITE_SHOP_SHOTS=1 (apps/web/test/browser/__shots__/).

const cfg = parseConfig('shop', {});
const now = new Date();
const endsAt = new Date(now.getTime() + 2 * 86_400_000 + 5 * 3_600_000).toISOString();

function productView(id: string): ShopProductView {
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
    offer: p.id === 'kit-explorador' ? { kind: 'bonus', percent: 50, endsAt } : null,
    badge: p.badge,
    featured: p.featured,
    first: p.firstBonus,
    maxPerAccount: p.kind === 'welcome' ? 1 : p.maxPerAccount,
    bought: 0,
    block: p.id === 'coins-6' ? 'daily_limit' : null,
  };
}

const view: ShopView = {
  open: true,
  closed: null,
  publishableKey: 'pk_live_shots',
  products: DEFAULT_SHOP_PRODUCTS.map((p) => productView(p.id)),
  limits: { dailyCents: 10_000, spentTodayCents: 1299, pendingMax: 3 },
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
  [2560, 1440],
] as const) {
  test(`tienda a ${w}×${h}`, async () => {
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
    root.render(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, { initialEntries: ['/tienda'] }, createElement(ShopScreen))));
    await new Promise((r) => setTimeout(r, 1400));
    expect(document.querySelectorAll('.shop-grid .pack-card')).toHaveLength(6);
    // The coins' tab (the first), the featured kit and the welcome pack: each draws its 84×84 sprite of the Aseprite
    // set, opaque pixels included.
    const arts = [...document.querySelectorAll<HTMLCanvasElement>('.shop-grid canvas.pack-art, canvas.shop-featured-canvas, canvas.shop-welcome-art')];
    expect(arts).toHaveLength(8);
    expect(arts.every((a) => a.width === 84 && a.height === 84)).toBe(true);
    await expect
      .poll(() => arts.every((a) => a.getContext('2d')!.getImageData(0, 0, 84, 84).data.some((v, i) => i % 4 === 3 && v === 255)), { timeout: 5000 })
      .toBe(true);
    expect(document.querySelector('.shop-featured')).not.toBeNull();
    // Never sideways.
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    if (import.meta.env['VITE_SHOP_SHOTS']) await page.screenshot({ path: `__shots__/shop-${w}.png` });
  }, 60_000);
}
