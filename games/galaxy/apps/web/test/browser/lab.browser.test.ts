import { type LabNode, type LabView, labEffects, labNodeStatus, nodeNextGain, nodeTotal, parseConfig } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { LabScreen } from '../../src/lab/LabScreen';
import '../../src/styles/app.css';

// The Laboratorio in a real browser with the app's styles, for review screenshots (VITE_ARENA_SHOTS=1): some nodes
// bought, one maxed, closed ones, and a wallet short for the deeper nodes.

const cfg = parseConfig('lab', {});
/** A node as the server sends it. */
const nodeView = (n: LabNode, levels: Record<string, number>) => {
  const status = labNodeStatus(n, levels, cfg);
  return { id: n.id, branch: n.branch, name: n.name, effect: n.effect, per: n.per, requires: n.requires, ...status, now: nodeTotal(n, status.level), nextGain: nodeNextGain(n, status.level), at: n.at };
};
const levels: Record<string, number> = { hull: 3, targeting: 1, resonance: 2, recycling: 1, throughput: 5, silos: 2, magnet: 1 };
const view: LabView = {
  open: true,
  nodes: cfg.nodes.map((n) => nodeView(n, levels)),
  season: null,
  effects: labEffects(levels, cfg),
  wallet: { coins: 1200, dust: 180, signal: 4, components: 60 },
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
  test(`laboratorio a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(view), { status: 200, headers: { 'content-type': 'application/json' } })));
    const host = document.createElement('div');
    document.body.style.margin = '0';
    document.body.appendChild(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    root = createRoot(host);
    root.render(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, createElement(LabScreen))));
    await new Promise((r) => setTimeout(r, 1200));
    expect(document.querySelectorAll('.lab-node')).toHaveLength(16);
    if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: `__shots__/lab-${w}.png` });
  }, 60_000);
}
