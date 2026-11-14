import type { MeResponse, ModChannel, ModMessage } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { AdminLayout } from '../../src/admin/AdminLayout';
import { LiveChat, ModerationLayout } from '../../src/admin/ModerationScreen';
import { modLiveChat, useModLive } from '../../src/api/moderation';
import '../../src/styles/app.css';

// Moderation's messages in a real browser (the owner's chat asks, 2026-11-14): the filters in a grid that never pushes
// the page sideways, every chat's messages with a box to tick, the selection bar, and what came while one looks; at
// 1280×720 and 1920×1080. Screenshots with VITE_MOD_SHOTS=1.

const me: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };
const channels: ModChannel[] = [
  { key: 'global', label: 'Comunidad', lastAt: '2026-11-14T09:00:00.000Z' },
  { key: 'clan:0f8f0d0e-6c1b-4c39-9a37-1f7b0c4c2a11', label: '[GX] Galácticos', lastAt: '2026-11-14T08:00:00.000Z' },
];
const AUTHORS = ['vega', 'orion_7', 'lyra', 'deneb', 'altair'];
const messages: ModMessage[] = Array.from({ length: 14 }, (_, i) => ({
  id: String(500 - i),
  channel: i % 3 === 2 ? channels[1]!.key : 'global',
  author: AUTHORS[i % AUTHORS.length]!,
  body: i % 4 === 1 ? 'Este mensaje es bastante largo para ver cómo se parte en varias líneas dentro de su tarjeta sin salirse de ella' : 'Alguien para una incursión en grupo esta tarde',
  at: new Date(Date.UTC(2026, 10, 14, 9, 40 - i)).toISOString(),
  hidden: i === 3 ? { reason: 'moderator', by: 'vigia', at: '2026-11-14T09:30:00.000Z' } : i === 6 ? { reason: 'deleted', by: 'vigia', at: '2026-11-14T09:20:00.000Z' } : null,
  reports: i === 1 ? 3 : 0,
  pending: i === 1 ? 2 : 0,
}));

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  useModLive.setState({ open: false, fresh: {}, reports: 0 });
  vi.unstubAllGlobals();
});

for (const [w, h] of [
  [1280, 720],
  [1920, 1080],
] as const) {
  test(`los mensajes de moderación a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const body = url.endsWith('/auth/me') ? me : url.endsWith('/moderation/channels') ? channels : url.includes('/moderation/messages?') ? messages : {};
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
          { initialEntries: ['/admin/moderacion/chat'] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: '/admin', element: createElement(AdminLayout) }, createElement(Route, { path: 'moderacion', element: createElement(ModerationLayout) }, createElement(Route, { path: 'chat', element: createElement(LiveChat) }))),
          ),
        ),
      ),
    );
    await expect.poll(() => document.querySelectorAll('.mod-message').length, { timeout: 5000 }).toBe(14);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    // The filters keep inside the page.
    const filters = document.querySelector<HTMLElement>('.mod-filters')!.getBoundingClientRect();
    expect(filters.right).toBeLessThanOrEqual(w);
    // Two ticked: the selection bar; something new came: its line.
    const boxes = [...document.querySelectorAll<HTMLInputElement>('.mod-pick input')];
    await userEvent.click(boxes[0]!);
    await userEvent.click(boxes[1]!);
    modLiveChat('global');
    await expect.poll(() => document.querySelector('.mod-selection') !== null && document.querySelector('.mod-fresh') !== null).toBe(true);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    if (import.meta.env['VITE_MOD_SHOTS']) await page.screenshot({ path: `__shots__/moderation-${w}.png` });
  });
}
