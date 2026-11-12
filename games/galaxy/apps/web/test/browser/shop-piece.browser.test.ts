import { parseConfig, productTab, purchaseGrants, type ShopProductView } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { ProductCard } from '../../src/shop/ProductCard';
import '../../src/styles/app.css';

// A style piece on its shop card (Nov plan C5), in a real browser with the app's styles: the avatar, the frame and the
// title fill the card's art box and sit in its middle, as a pack's sprite does. A screenshot with VITE_SHOP_SHOTS=1.

const cfg = parseConfig('shop', {});
function productView(id: string): ShopProductView {
  const p = cfg.products.find((x) => x.id === id)!;
  const { base, extra, total } = purchaseGrants(p, new Date(), p.firstBonus, cfg);
  return { id: p.id, kind: p.kind, tab: productTab(p), name: p.name, art: p.art, base, bonus: { ...p.bonus }, extra, total, priceCents: p.priceCents, beforeCents: null, offer: null, badge: p.badge, featured: p.featured, first: p.firstBonus, maxPerAccount: p.maxPerAccount, bought: 0, block: null, cosmetic: p.cosmetic };
}

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const mid = (r: DOMRect) => [r.left + r.width / 2, r.top + r.height / 2] as const;

test('el avatar, el marco y el título llenan el hueco del dibujo y van centrados', async () => {
  await page.viewport(1600, 900);
  vi.stubGlobal('fetch', () => new Promise(() => {}));
  const host = document.createElement('div');
  host.style.cssText = 'display:grid;grid-template-columns:repeat(3,280px);gap:16px;padding:16px';
  document.body.append(host);
  root = createRoot(host);
  const client = new QueryClient();
  const ids = ['style-star-fox', 'style-prism', 'style-patron'];
  root.render(createElement(QueryClientProvider, { client }, ids.map((id, i) => createElement(ProductCard, { key: id, product: productView(id), index: i, firstPercent: 100, reduced: true, onBuy: () => {} }))));
  await frames();
  const arts = [...host.querySelectorAll<HTMLElement>('.pack-art')];
  expect(arts).toHaveLength(3);
  for (const art of arts) {
    const box = art.getBoundingClientRect();
    expect(box.width).toBeGreaterThanOrEqual(140);
    const piece = art.querySelector<HTMLElement>('.avatar-box, .title-text')!;
    const r = piece.getBoundingClientRect();
    const [ax, ay] = mid(box);
    const [px, py] = mid(r);
    expect(Math.abs(px - ax)).toBeLessThan(2);
    expect(Math.abs(py - ay)).toBeLessThan(2);
  }
  // The avatar and the frame's face at 96 px (3× their 32 px art); the title large enough to read as the piece.
  expect(arts[0]!.querySelector<HTMLElement>('.avatar-box')!.getBoundingClientRect().width).toBe(96);
  expect(arts[1]!.querySelector<HTMLElement>('.avatar-box')!.getBoundingClientRect().width).toBe(96);
  expect(parseFloat(getComputedStyle(arts[2]!.querySelector('.title-text')!).fontSize)).toBeGreaterThanOrEqual(20);
  if (import.meta.env['VITE_SHOP_SHOTS']) await page.screenshot({ path: '__shots__/shop-pieces.png', element: host });
});
