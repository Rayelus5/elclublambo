import type { StationView } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { StationScreen } from '../../src/station/StationScreen';
import '../../src/styles/app.css';

// The station's screen in a real browser, with the rooms' Aseprite strips playing, for review screenshots
// (VITE_ARENA_SHOTS=1).

const view: StationView = {
  rooms: [
    { id: 'scanner', state: 'working', level: 1, maxLevel: 1, next: null },
    { id: 'planetarium', state: 'working', level: 1, maxLevel: 1, next: null },
    { id: 'lab', state: 'future', level: 0, maxLevel: 0, next: null },
    { id: 'hangar', state: 'working', level: 1, maxLevel: 1, next: null },
    { id: 'collider', state: 'working', level: 1, maxLevel: 1, next: null },
    { id: 'comms', state: 'future', level: 0, maxLevel: 0, next: null },
    { id: 'refinery', state: 'working', level: 2, maxLevel: 5, next: { cost: { components: 90, coins: 1200 } } },
    { id: 'antenna', state: 'broken', level: 0, maxLevel: 5, next: { cost: { components: 30, coins: 0 } } },
    { id: 'archive', state: 'future', level: 0, maxLevel: 0, next: null },
    { id: 'trophies', state: 'future', level: 0, maxLevel: 0, next: null },
  ],
  refinery: { level: 2, rate: 30, capacity: 150, queue: 62, ready: 18, nextAt: '2026-11-07T11:03:00.000Z' },
  antenna: { level: 0, rate: 0, capHours: 8, accrued: 0, fullAt: null },
  wallet: { coins: 1840, dust: 64, signal: 6, material: 145, components: 22 },
};

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function mount(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(view), { status: 200, headers: { 'content-type': 'application/json' } })),
  );
  const host = document.createElement('div');
  document.body.style.margin = '0';
  document.body.appendChild(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(host);
  root.render(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, createElement(StationScreen))));
}

for (const [w, h] of [
  [1280, 720],
  [1600, 900],
  [1920, 1080],
] as const) {
  test(`estación a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    mount();
    await new Promise((r) => setTimeout(r, 1200));
    expect(document.querySelectorAll('.station-decks > li')).toHaveLength(10);
    if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: `__shots__/station-${w}.png` });
  }, 60_000);
}

test('panel de la refinería a 1600×900', async () => {
  await page.viewport(1600, 900);
  mount();
  await new Promise((r) => setTimeout(r, 1200));
  await userEvent.click(page.getByRole('button', { name: /Refinería/ }));
  await new Promise((r) => setTimeout(r, 500));
  expect(document.querySelector('.station-panel')).not.toBeNull();
  if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: '__shots__/station-refinery-1600.png' });
}, 60_000);

test('panel de la antena rota a 1600×900', async () => {
  await page.viewport(1600, 900);
  mount();
  await new Promise((r) => setTimeout(r, 1200));
  await userEvent.click(page.getByRole('button', { name: /Antena/ }));
  await new Promise((r) => setTimeout(r, 500));
  expect(document.querySelector('.station-panel')).not.toBeNull();
  if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: '__shots__/station-antenna-1600.png' });
}, 60_000);
