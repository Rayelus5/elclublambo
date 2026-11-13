import { renderFromSeed } from '@galaxy/engine';
import type { CollectionPage, GachaView, GalaxySummary, Tier } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { CollectionScreen } from '../../src/collection/CollectionScreen';
import { DisintegrateFx } from '../../src/collection/DisintegrateFx';
import '../../src/styles/app.css';

// Desintegrar varias in a real browser (the owner): the tray under the grid with its rarity counts, at four widths,
// never pushing the page sideways; and the animation mid-way (cards coming apart, motes, dust flying to the wallet).
// Screenshots with VITE_DISSOLVE_SHOTS=1.

const TIERS: Tier[] = ['common', 'common', 'uncommon', 'rare', 'epic', 'legendary', 'common', 'rare'];
const galaxy = (i: number): GalaxySummary => ({
  id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`,
  seed: String(9_100_001 + i * 7919),
  tier: TIERS[i % TIERS.length]!,
  finish: 'normal',
  traits: renderFromSeed(BigInt(9_100_001 + i * 7919), { columns: 48 }).traits as unknown as Record<string, string>,
  name: ['Kathra', 'Selem', 'Uxorrei', 'Thaselos', 'Zenreila', 'Orvane', 'Lyss', 'Tamber'][i % 8]!,
  designation: `GX-00${i}A7F`,
  featured: false,
  level: 1,
  createdAt: '2026-11-06T20:00:00Z',
});
const items = Array.from({ length: 12 }, (_, i) => galaxy(i));
const collection: CollectionPage = { items, counts: { common: 5, uncommon: 2, rare: 3, epic: 1, legendary: 1, mythic: 0 }, fusion: { count: 5, dust: [20, 50, 120, 300] } };
const gacha: GachaView = { banners: [], costs: { coins: 100, coinsTen: 900, signals: 1 }, freePullAvailable: false, wallet: { coins: 1200, dust: 340, signal: 4 } };

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function mount(node: ReturnType<typeof createElement>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = url.includes('/galaxies?') ? collection : url.endsWith('/gacha') ? gacha : {};
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
      createElement(MemoryRouter, { initialEntries: ['/coleccion'] }, createElement(Routes, null, createElement(Route, { path: '/coleccion', element: node }))),
    ),
  );
}

for (const [w, h] of [
  [1280, 720],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
] as const) {
  test(`la bandeja de desintegrar varias a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    mount(createElement(CollectionScreen));
    await expect.poll(() => document.querySelectorAll('.card-grid li').length, { timeout: 10_000 }).toBe(12);
    const open = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Desintegrar varias'))!;
    open.click();
    await expect.poll(() => document.querySelectorAll('.gcard-hit[aria-pressed]').length).toBe(12);
    for (const b of [...document.querySelectorAll<HTMLButtonElement>('.gcard-hit[aria-pressed]')].slice(0, 6)) b.click();
    await expect.poll(() => document.querySelectorAll('.dissolve-tier').length).toBeGreaterThan(2);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    const bar = document.querySelector<HTMLElement>('.dissolve-bar')!.getBoundingClientRect();
    expect(bar.right).toBeLessThanOrEqual(w);
    if (import.meta.env['VITE_DISSOLVE_SHOTS']) await page.screenshot({ path: `__shots__/dissolve-bar-${w}.png` });
  }, 60_000);
}

test('la animación de desintegrar: las cartas se deshacen y el polvo vuela a la cartera', async () => {
  await page.viewport(1600, 900);
  document.body.style.cssText = 'margin:0;background:#070a1c;';
  // The wallet's dust, where the chips fly to.
  const wallet = document.createElement('span');
  wallet.className = 'res dust';
  wallet.style.cssText = 'position:fixed;right:40px;top:30px;width:80px;height:30px;';
  document.body.appendChild(wallet);
  mount(createElement(DisintegrateFx, { galaxies: items.slice(0, 9), dust: 640, reduced: false, onDone: () => {} }));
  await expect.poll(() => document.querySelectorAll('.dissolve-card').length).toBe(7);
  expect(document.querySelector('.dissolve-more')?.textContent).toBe('+2');
  expect(document.querySelectorAll('.claim-chip.dust').length).toBeGreaterThan(3);
  expect(document.querySelectorAll('.dissolve-mote').length).toBe(7 * 16);
  await new Promise((r) => setTimeout(r, 1100));
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1600);
  if (import.meta.env['VITE_DISSOLVE_SHOTS']) await page.screenshot({ path: '__shots__/dissolve-fx-mid.png' });
  await new Promise((r) => setTimeout(r, 700));
  if (import.meta.env['VITE_DISSOLVE_SHOTS']) await page.screenshot({ path: '__shots__/dissolve-fx-late.png' });
}, 60_000);
