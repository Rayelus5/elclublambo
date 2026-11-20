import type { AdminPlayerList, AdminPlayerRow, MeResponse } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { AdminLayout } from '../../src/admin/AdminLayout';
import { PlayersScreen } from '../../src/admin/PlayersScreen';
import '../../src/styles/app.css';

// The admin's players list in a real browser (plan «escáner pro», part F): a full page of 50 inside the panel, its
// toolbar and sortable headers, and the delete dialog, at four widths; the page never grows sideways (the table scrolls
// inside its frame). Screenshots with VITE_PLAYERS_SHOTS=1.

const me: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };
const NAMES = ['vega', 'orion', 'lyra', 'altair', 'deneb', 'rigel', 'sirius', 'antares', 'polaris', 'capella'];
const players: AdminPlayerRow[] = Array.from({ length: 50 }, (_, i) => ({
  username: i === 7 ? 'borrado_0a1b2c3d' : `${NAMES[i % NAMES.length]}_${String(i).padStart(2, '0')}`,
  level: 40 - (i % 37),
  createdAt: new Date(Date.UTC(2026, 10, 12 - (i % 11), 10, i)).toISOString(),
  lastSeen: i % 4 === 0 ? null : new Date(Date.UTC(2026, 10, 12, 9, i)).toISOString(),
  banned: i % 9 === 3 || i === 7,
  roles: i === 2 ? ['moderator'] : [],
  clan: i % 3 === 0 ? 'GX' : null,
  online: i % 5 === 1,
  muted: i % 13 === 4,
  deletedAt: i === 7 ? '2026-11-12T10:00:00.000Z' : null,
}));
const list: AdminPlayerList = { players, total: 1284, page: 1, pages: 26 };

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
  test(`la lista de jugadores a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const body = url.endsWith('/auth/me') ? me : url.includes('/admin/players?') ? list : {};
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
          { initialEntries: ['/admin/jugadores'] },
          createElement(Routes, null, createElement(Route, { path: '/admin', element: createElement(AdminLayout) }, createElement(Route, { path: 'jugadores', element: createElement(PlayersScreen) }))),
        ),
      ),
    );
    await expect.poll(() => document.querySelectorAll('.players-table tbody tr').length, { timeout: 5000 }).toBe(50);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    // The toolbar sits inside the page, search and state on one line.
    const search = document.querySelector<HTMLElement>('.players-toolbar .admin-search')!.getBoundingClientRect();
    const state = document.querySelector<HTMLElement>('.players-toolbar .players-state')!.getBoundingClientRect();
    expect(Math.abs(search.top - state.top)).toBeLessThan(4);
    if (import.meta.env['VITE_PLAYERS_SHOTS']) await page.screenshot({ path: `__shots__/admin-players-${w}.png` });

    if (w === 1280) {
      document.querySelector<HTMLButtonElement>('.row-actions button')!.click();
      await expect.poll(() => document.querySelector('.modal.admin-dialog'), { timeout: 3000 }).not.toBeNull();
      const modal = document.querySelector<HTMLElement>('.modal.admin-dialog')!.getBoundingClientRect();
      expect(modal.right).toBeLessThanOrEqual(w);
      expect(document.querySelector('.admin-dialog [role="switch"]')).not.toBeNull();
      await new Promise((r) => setTimeout(r, 700));
      if (import.meta.env['VITE_PLAYERS_SHOTS']) await page.screenshot({ path: `__shots__/admin-players-delete-${w}.png` });
    }
  }, 60_000);
}
