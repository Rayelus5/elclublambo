import type { GalaxySummary, HangarView, ProbeCard, RunResult, SectorCard } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { levelOne } from '../probe-cards';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { HangarScreen } from '../../src/hangar/HangarScreen';
import { ResultsScreen } from '../../src/hangar/ResultsScreen';
import { TeamResults } from '../../src/coop/TeamResults';
import '../../src/styles/app.css';

// The hangar (the lobby) and the results with the app's real styles: the lobby's areas never overlap at any of these
// sizes; review screenshots with VITE_ARENA_SHOTS=1.

const g = (id: string, name: string, tier: GalaxySummary['tier'], traits: Record<string, string>): GalaxySummary => ({
  id,
  seed: String(9000 + id.length * 31 + id.charCodeAt(0)),
  tier,
  finish: tier === 'legendary' ? 'holo' : 'normal',
  traits,
  name,
  designation: 'GX-1A2B3C',
  featured: false,
  level: 1,
  createdAt: '2026-11-06T20:00:00Z',
  equipped: true,
});

const card = (id: string, over: Partial<ProbeCard> = {}): ProbeCard => {
  const p = DEFAULT_CONTENT.probes.find((x) => x.id === id)!;
  const w = DEFAULT_CONTENT.weapons.find((x) => x.id === p.weapon)!;
  return { id, name: p.name, description: p.description, sprite: p.sprite, hp: p.hp, speed: p.speed, weapon: { id: w.id, name: w.name, icon: w.icon }, quirk: p.quirk ?? null, unlocked: false, condition: null, progress: 0, ...levelOne(p), ...over };
};

const sectorCard = (id: string, over: Partial<SectorCard> = {}): SectorCard => {
  const sec = DEFAULT_CONTENT.sectors.find((x) => x.id === id)!;
  const boss = DEFAULT_CONTENT.bosses.find((b) => b.id === sec.boss)!;
  const fauna = [...new Set(sec.spawns.map((sp) => sp.enemy))].map((e) => DEFAULT_CONTENT.enemies.find((x) => x.id === e)!);
  return {
    id,
    name: sec.name,
    description: sec.description,
    boss: { name: boss.name, title: boss.title, sprite: boss.sprite },
    fauna: fauna.map((e) => ({ id: e.id, name: e.name, sprite: e.sprite })),
    layerSeconds: sec.layerSeconds,
    biome: sec.biome,
    unlocked: false,
    condition: null,
    progress: 0,
    season: sec.season,
    ...over,
  };
};

const view: HangarView = {
  // A player who beat the Nebulosa's Core: the Escarcha open, the rest of the chain closed, the season open.
  sectors: [
    sectorCard('outer-nebula', { unlocked: true, progress: 1 }),
    sectorCard('frost-rings', { unlocked: true, condition: { sector: 'outer-nebula', stat: 'bossKills', value: 1 }, progress: 1 }),
    sectorCard('hollow-reef', { condition: { sector: 'frost-rings', stat: 'bossKills', value: 1 } }),
    sectorCard('broken-forge', { condition: { sector: 'hollow-reef', stat: 'bossKills', value: 1 } }),
    sectorCard('signal-rift', { unlocked: true, progress: 1 }),
  ],
  // The season chosen: its long name wraps beside the check (seen on PRE).
  sector: 'signal-rift',
  probes: [
    // Lumen at level 4 with the double pulse chosen (M4b-1).
    card('lumen', { unlocked: true, progress: 1, ...levelOne(DEFAULT_CONTENT.probes.find((x) => x.id === 'lumen')!, 4, 'pulse-twin') }),
    card('bastion', { unlocked: true, condition: { stat: 'runs', value: 3 }, progress: 1 }),
    card('spark', { condition: { stat: 'runs', value: 3 }, progress: 1 / 3 }),
    card('sentinel', { condition: { stat: 'bossKills', value: 3 }, progress: 0 }),
    card('anchor', { condition: { stat: 'maxDepth', value: 4 }, progress: 2 / 4 }),
    card('prism', { condition: { stat: 'extractions', value: 5 }, progress: 1 / 5 }),
    card('comet', { condition: { stat: 'kills', value: 2000 }, progress: 1240 / 2000 }),
    card('echo', { condition: { stat: 'runs', value: 15 }, progress: 3 / 15 }),
  ],
  probe: 'lumen',
  test: { taken: true, probe: 'lumen' },
  slots: 2,
  maxSlots: 6,
  loadout: [
    g('a', 'Kathra', 'legendary', { galaxy_type: 'spiral', arms: '4', size: 'large', inclination: 'tilted', core: 'quasar', star_density: 'dense', palette: 'solar_gold', background: 'starfield', phenomenon: 'pulsar' }),
    // A second galaxy that makes sets with the first: the same palette, and the phenomenon its spiral wants.
    g('b', 'Orvel', 'rare', { galaxy_type: 'barred_spiral', arms: '2', size: 'medium', inclination: 'face_on', core: 'bright', star_density: 'normal', palette: 'solar_gold', background: 'cmb', phenomenon: 'satellite_galaxy' }),
  ],
  daily: { playedSeconds: 1200, fullSecondsLeft: 3 * 3600 - 1200, multiplier: 1, fullHours: 3, resetsAt: '2026-11-07T23:00:00.000Z' },
  runsEnabled: true,
  nextSlot: { slot: 3, condition: { stat: 'runs', value: 5 }, progress: 1, dust: 100, ready: true },
};

const result: RunResult = {
  id: 'r1',
  outcome: 'extracted',
  ticks: 13 * 3600 + 12 * 60,
  depth: 2,
  kills: 1412,
  level: 22,
  payout: { coins: 132, dust: 41, signals: 1, material: 28 },
  breakdown: {
    layers: [
      { layer: 1, coins: 52, dust: 17, multiplier: 1 },
      { layer: 2, coins: 40, dust: 12, multiplier: 1.5 },
    ],
    share: 1,
    daily: [{ seconds: 792, multiplier: 1 }],
  },
  wallet: { coins: 232, dust: 53, signal: 11 },
  progress: { xp: 0, level: 1, levelUp: false, points: 0 },
};

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function mount(el: ReturnType<typeof createElement>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const known: Record<string, unknown> = {
        '/hangar': view,
        '/gacha': { banners: [], costs: { coins: 100, coinsTen: 900, signals: 1 }, freePullAvailable: false, wallet: { coins: 232, dust: 53, signal: 11, components: 40 } },
        '/auth/me': { id: 'a1', username: 'piloto_rayo', roles: [], mfa: false, level: 4 },
        '/rooms': { mine: null, open: [], allowed: true, reason: null, minLevel: 1 },
      };
      const key = Object.keys(known).find((k) => url.endsWith(k));
      // What this page does not need here answers as missing (its panels show nothing, as when it fails).
      if (!key) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify(known[key]), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
  const host = document.createElement('div');
  document.body.style.margin = '0';
  document.body.appendChild(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(host);
  root.render(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, el)));
}

for (const [w, h] of [
  [1280, 720],
  [1440, 900],
  [1600, 900],
  [1920, 1080],
  [3440, 1440],
] as const) {
  test(`hangar a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    mount(createElement(HangarScreen));
    await new Promise((r) => setTimeout(r, 1500));
    expect(document.querySelector('.lobby')).not.toBeNull();
    // The lobby's areas never overlap (the owner: «nada tape nada»), and nothing pushes the page sideways.
    const names = ['.lobby-top', '.lobby-rail', '.lobby-stage', '.lobby-side', '.lobby-foot'];
    const areas = names.map((sel) => document.querySelector(sel)!.getBoundingClientRect());
    for (let i = 0; i < areas.length; i++)
      for (let j = i + 1; j < areas.length; j++) {
        const [a, b] = [areas[i]!, areas[j]!];
        expect(a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1, `${names[i]} × ${names[j]}`).toBe(false);
      }
    const screenRoot = document.querySelector('.screen-root')!;
    expect(screenRoot.scrollWidth).toBeLessThanOrEqual(screenRoot.clientWidth + 1);
    if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: `__shots__/hangar-${w}.png` });
  }, 60_000);
}

test('resultados a 1280×720', async () => {
  await page.viewport(1280, 720);
  mount(createElement('div', { className: 'screen-root hangar-root' }, createElement('div', { className: 'hangar' }, createElement(ResultsScreen, { result, onAgain: () => {} }))));
  await new Promise((r) => setTimeout(r, 1500));
  expect(document.querySelector('.results')).not.toBeNull();
  if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: '__shots__/results-1280.png' });
}, 60_000);

test('resultados en grupo a 1280×720: la tabla del equipo cabe', async () => {
  await page.viewport(1280, 720);
  const rows = [
    { slot: 0, name: 'piloto_rayo', probe: 'Lumen', sprite: 'probe-lumen', level: 9, kills: 120, revives: 0, downs: 2, life: 'up' as const },
    { slot: 1, name: 'vega_de_la_nebulosa', probe: 'Bastión', sprite: 'probe-bastion', level: 12, kills: 340, revives: 3, downs: 0, life: 'up' as const },
    { slot: 2, name: 'lyra', probe: 'Chispa', sprite: 'probe-spark', level: 4, kills: 15, revives: 0, downs: 1, life: 'left' as const },
    { slot: 3, name: 'orion', probe: 'Vigía', sprite: 'probe-sentinel', level: 7, kills: 88, revives: 1, downs: 1, life: 'out' as const },
  ];
  const team = createElement(TeamResults, { rows, me: 0 });
  mount(createElement('div', { className: 'screen-root hangar-root' }, createElement('div', { className: 'hangar' }, createElement(ResultsScreen, { result, onAgain: () => {}, team }))));
  await new Promise((r) => setTimeout(r, 1200));
  expect(document.querySelector('.team-results table')).not.toBeNull();
  const box = document.querySelector('.team-results')!;
  expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
  // Every row (mine too) is a row of the table: its figures line up under their headings, and no heading wraps.
  const heads = [...document.querySelectorAll('.team-results thead th')].map((h) => h.getBoundingClientRect());
  for (const tr of document.querySelectorAll('.team-results tbody tr')) {
    expect(getComputedStyle(tr).display).toBe('table-row');
    const cells = [...tr.children].map((c) => c.getBoundingClientRect());
    cells.forEach((c, i) => expect(Math.abs(c.right - heads[i]!.right)).toBeLessThan(2));
  }
  for (const h of heads) expect(h.height).toBeLessThan(24);
  box.scrollIntoView({ block: 'start' });
  if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: '__shots__/results-team-1280.png' });
}, 60_000);
