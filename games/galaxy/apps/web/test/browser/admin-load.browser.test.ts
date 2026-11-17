import type { AdminLoadSample } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { ServerLoad } from '../../src/admin/ServerLoad';
import '../../src/styles/app.css';

// «Carga del servidor» (2026-11-17) with the app's styles: the tiles fit at 1280 and 1920 without pushing the page
// sideways, and hovering a line shows the value at that moment. VITE_ADMIN_SHOTS=1 saves it.

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const sample = (i: number): AdminLoadSample => ({
  at: new Date(Date.parse('2026-11-17T12:00:00Z') + i * 15_000).toISOString(),
  rooms: { lobby: 2 + (i % 3), starting: 0, running: 1 + (i % 4 === 0 ? 1 : 0), max: 10 },
  players: 5 + Math.round(4 * Math.sin(i / 20)),
  coop: { runs: 2, connected: 7 },
  solo: 4,
  sockets: 31,
  referee: { core: 0.012, p99: 0.8 },
  loop: { p50: 11, p99: 18 + (i % 9) * 3, max: 61 },
  cpu: 0.02 + 0.015 * Math.abs(Math.sin(i / 11)),
  memory: { rss: 210 * 1024 * 1024, heap: 95 * 1024 * 1024 },
  uptime: 3720 + i * 15,
});
const view = { now: sample(240), history: Array.from({ length: 240 }, (_, i) => sample(i)), sampleMs: 15_000 };

for (const [w, h] of [
  [1280, 720],
  [1920, 1080],
] as const) {
  test(`la carga del servidor cabe a ${w}×${h} y su línea enseña el valor al pasar el ratón`, async () => {
    await page.viewport(w, h);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(view), { status: 200, headers: { 'content-type': 'application/json' } })));
    const host = document.createElement('div');
    host.style.cssText = 'padding:24px;background:#0b0d2a';
    document.body.style.margin = '0';
    document.body.append(host);
    root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    root.render(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, createElement(ServerLoad))));
    await vi.waitFor(() => expect(document.querySelectorAll('.load-tile')).toHaveLength(10), { timeout: 20_000, interval: 100 });
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    for (const tile of document.querySelectorAll<HTMLElement>('.load-tile')) expect(tile.scrollWidth, tile.textContent ?? '').toBeLessThanOrEqual(tile.clientWidth + 1);
    const svg = document.querySelector<SVGSVGElement>('.load-spark svg')!;
    await userEvent.hover(svg);
    await vi.waitFor(() => expect(document.querySelector('.load-tip')).not.toBeNull());
    if (import.meta.env['VITE_ADMIN_SHOTS']) await page.screenshot({ path: `__shots__/admin-load-${w}.png`, element: host });
  });
}
