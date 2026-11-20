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

const cfg = parseConfig('lab', {
  season: [
    { id: 'swarm-hunt', branch: 'probe', name: 'Cazador del enjambre', effect: { kind: 'stat', stat: 'damage' }, per: 0.03, max: 3, requires: null, cost: { dust: 30, components: 10 }, growth: 1.5 },
    { id: 'swarm-reap', branch: 'extraction', name: 'Cosecha', effect: { kind: 'payout', currency: 'dust' }, per: 0.04, max: 3, requires: 'swarm-hunt', cost: { dust: 40, components: 10 }, growth: 1.5 },
    { id: 'swarm-wall', branch: 'relics', name: 'Muralla', effect: { kind: 'stat', stat: 'maxHp' }, per: 0.03, max: 3, requires: null, cost: { dust: 30, components: 10 }, growth: 1.5 },
  ],
});
/** A node as the server sends it. */
const nodeView = (n: LabNode, levels: Record<string, number>, tree: LabNode[] = cfg.nodes) => {
  const status = labNodeStatus(n, levels, tree);
  return { id: n.id, branch: n.branch, name: n.name, effect: n.effect, per: n.per, requires: n.requires, ...status, now: nodeTotal(n, status.level), nextGain: nodeNextGain(n, status.level), at: n.at };
};
const levels: Record<string, number> = { hull: 3, targeting: 1, resonance: 2, recycling: 1, throughput: 5, silos: 2, magnet: 1 };
const view: LabView = {
  open: true,
  nodes: cfg.nodes.map((n) => nodeView(n, levels)),
  season: { id: 'season-2', name: 'Temporada 2', endsAt: '2027-01-04T23:00:00.000Z', nodes: cfg.season.map((n) => nodeView(n, { 'swarm-hunt': 2 }, cfg.season)) },
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
  [2560, 1440],
] as const) {
  for (const list of [false, true]) {
    test(`laboratorio ${list ? 'en lista' : 'en pizarra'} a ${w}×${h}`, async () => {
      await page.viewport(w, h);
      vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/redshift') ? { rank: 0, maxRank: 5, minLevel: 25, level: 3, labLevels: 0, needed: 10, eligible: false, bonus: { xp: 0, luck: 0 }, next: null } : view), { status: 200, headers: { 'content-type': 'application/json' } })));
      const host = document.createElement('div');
      document.body.style.margin = '0';
      host.style.height = `${h}px`;
      document.body.appendChild(host);
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      root = createRoot(host);
      root.render(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, { initialEntries: [list ? '/laboratorio?vista=lista' : '/laboratorio'] }, createElement(LabScreen))));
      await new Promise((r) => setTimeout(r, 1200));
      if (list) expect(document.querySelectorAll('.lab-node')).toHaveLength(16);
      else expect(document.querySelectorAll('.lab-n')).toHaveLength(19);
      // Never sideways.
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
      if (import.meta.env['VITE_ARENA_SHOTS'] || import.meta.env['VITE_LAB_SHOTS']) await page.screenshot({ path: `__shots__/lab-${list ? 'list' : 'board'}-${w}.png` });
    }, 60_000);
  }
}
