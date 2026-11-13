import type { AdminStorage, MeResponse } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { AdminLayout } from '../../src/admin/AdminLayout';
import { StorageScreen } from '../../src/admin/StorageScreen';
import '../../src/styles/app.css';

// «Almacenamiento» in a real browser: its tiles and the biggest tables inside the panel, at four desktop widths (the panel's own);
// the page never grows sideways (the table scrolls inside its frame). Screenshots with VITE_STORAGE_SHOTS=1.

const me: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };
const MB = 1024 * 1024;
const NAMES = ['ledger', 'runs', 'galaxies', 'audit_log', 'chat_messages', 'sessions', 'missions_progress', 'market_listings', 'cosmetics', 'probe_levels', 'mail', 'notices'];
const storage: AdminStorage = {
  readAt: '2026-11-13T00:40:00.000Z',
  database: { bytes: 34 * MB, gameBytes: 21 * MB },
  disk: { totalBytes: 80 * 1024 * MB, freeBytes: 51 * 1024 * MB },
  galaxies: { live: 440, disintegrated: 597, bytes: 752 * 1024 },
  tables: NAMES.map((name, i) => ({ name, rows: i === 11 ? null : Math.round(52_000 / (i + 1)), bytes: Math.round((6 * MB) / (i + 1)), indexBytes: Math.round((2 * MB) / (i + 1)) })),
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
  test(`el almacenamiento a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const body = url.endsWith('/auth/me') ? me : url.endsWith('/admin/storage') ? storage : {};
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
        createElement(
          MemoryRouter,
          { initialEntries: ['/admin/almacenamiento'] },
          createElement(Routes, null, createElement(Route, { path: '/admin', element: createElement(AdminLayout) }, createElement(Route, { path: 'almacenamiento', element: createElement(StorageScreen) }))),
        ),
      ),
    );
    await expect.poll(() => document.querySelectorAll('.storage-tables tbody tr').length, { timeout: 5000 }).toBe(12);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    // The disk's bar fills as much as is used (29 of 80).
    const bar = document.querySelector<HTMLElement>('.storage-meter')!.getBoundingClientRect();
    const fill = document.querySelector<HTMLElement>('.storage-meter > span')!.getBoundingClientRect();
    expect(fill.width / bar.width).toBeCloseTo(29 / 80, 1);
    if (import.meta.env['VITE_STORAGE_SHOTS']) await page.screenshot({ path: `__shots__/admin-storage-${w}.png` });
  }, 60_000);
}
