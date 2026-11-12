import type { GalaxySummary } from '@galaxy/shared';
import { generateGalaxy } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { RelicSheet } from '../../src/hangar/RelicSheet';
import '../../src/styles/app.css';

// The relic sheet in a real browser (plan «escáner pro», part D): the card in 3D beside every power, inside the
// screen at the usual sizes, with «Equipar» in reach. VITE_SHEET_SHOTS=1 saves a screenshot.

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function galaxy(seed: bigint, tier: number, id: string): GalaxySummary {
  const g = generateGalaxy(seed, tier);
  return {
    id,
    seed: g.seed.toString(),
    tier: (['common', 'uncommon', 'rare', 'epic', 'legendary'] as const)[tier]!,
    finish: tier === 4 ? 'holo' : 'normal',
    traits: g.traits as unknown as Record<string, string>,
    name: g.name,
    designation: g.designation,
    level: 3,
  } as unknown as GalaxySummary;
}

for (const [w, h] of [
  [1280, 720],
  [1920, 1080],
] as const) {
  test(`la ficha de una reliquia cabe con su 3D y «Equipar» a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    const candidate = galaxy(777_001n, 4, 'c1');
    const loadout = [galaxy(777_002n, 2, 'a1'), galaxy(777_003n, 3, 'a2'), null];
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    flushSync(() =>
      root!.render(
        createElement(
          QueryClientProvider,
          { client: new QueryClient() },
          createElement(RelicSheet, { galaxy: candidate, mode: 'equip', loadout, slot: 1, onEquip: () => {}, onBack: () => {}, onClose: () => {} }),
        ),
      ),
    );
    await new Promise((r) => setTimeout(r, 2500));
    const modal = document.querySelector<HTMLElement>('.modal.relic-sheet')!;
    const box = modal.getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(w);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    const equip = [...modal.querySelectorAll('button')].find((b) => b.textContent?.includes('Equipar'))!;
    expect(equip).toBeTruthy();
    expect(modal.querySelectorAll('.relic-sheet-powers li').length).toBeGreaterThanOrEqual(3);
    if (import.meta.env['VITE_SHEET_SHOTS']) await page.screenshot({ path: `__shots__/relic-sheet-${w}.png` });
  }, 60_000);
}
