import { generateGalaxy, type CollectionPage, type GachaView, type GalaxySummary, type HangarView, type LabView, type ProbeCard, type PulledGalaxy, type PullResponse, type SectorCard, type StationView, labEffects, labNodeStatus, parseConfig } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { test } from 'vitest';
import { CollectionScreen } from '../../apps/web/src/collection/CollectionScreen';
import { HangarScreen } from '../../apps/web/src/hangar/HangarScreen';
import { Inspector } from '../../apps/web/src/inspector/Inspector';
import { LabScreen } from '../../apps/web/src/lab/LabScreen';
import { ScannerScreen } from '../../apps/web/src/scanner/ScannerScreen';
import { StationScreen } from '../../apps/web/src/station/StationScreen';
import { levelOne } from '../../apps/web/test/probe-cards';
import '../../apps/web/src/styles/app.css';
import { installVirtualTime, record, type VirtualTime } from './vt';

// The game's screens for the trailer, with their data fixed in the page (no server, no database) and the galaxies
// made by the game's own generator, recorded at 60 fps on the virtual clock. SCENE picks one (env VITE_SCENE).

const SCENE = import.meta.env['VITE_SCENE'] ?? 'station';
const FRAMES = Number(import.meta.env['VITE_FRAMES'] ?? 0);
const SKIP = Number(import.meta.env['VITE_SKIP'] ?? 0);
const TIERS = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
function api(routes: Record<string, (init?: RequestInit) => unknown>): void {
  window.fetch = (async (url: string, init?: RequestInit) => {
    const u = new URL(url, location.origin);
    const path = u.pathname.replace(/^\/galaxy\/api/, '');
    const method = init?.method ?? 'GET';
    const h = routes[`${method} ${path}${u.search}`] ?? routes[`${method} ${path}`];
    if (!h) return json({ error: 'not_found' }, 404);
    const out = h(init);
    return out instanceof Response ? out : json(out);
  }) as typeof fetch;
}

function mount(route: string, el: ReactElement): void {
  document.body.style.margin = '0';
  const host = document.createElement('div');
  document.body.appendChild(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  createRoot(host).render(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, { initialEntries: [route] }, el)));
}

/** A real galaxy of this tier from the game's generator (deterministic by `n`). */
function galaxy(n: number, tier: number, finish = 'normal', featured?: { trait: 'phenomenon'; value: string }): GalaxySummary & PulledGalaxy {
  const gen = generateGalaxy(BigInt(100_003 + n * 7919), tier, featured);
  return {
    id: `g${n}`,
    seed: gen.seed.toString(),
    tier: TIERS[tier]!,
    finish: finish as GalaxySummary['finish'],
    traits: gen.traits as unknown as GalaxySummary['traits'],
    name: gen.name,
    designation: gen.designation,
    featured: !!featured,
    level: 1 + (n % 4),
    createdAt: '2026-11-10T20:00:00Z',
    equipped: false,
  } as GalaxySummary & PulledGalaxy;
}

/** Waits (real time) until `check`, at most `ms`. */
async function until(vt: VirtualTime, check: () => boolean, ms = 8000): Promise<void> {
  const t0 = Date.now.call(Date);
  for (let waited = 0; !check() && waited < ms; waited += 50) await vt.sleep(50);
  void t0;
}
/** Lets the screen load: data, fonts, first frames. */
async function warm(vt: VirtualTime, frames = 40): Promise<void> {
  for (let i = 0; i < frames; i++) {
    await vt.advance(1000 / 60);
    await vt.sleep(10);
  }
  await vt.settle();
}
/** Before each frame: any galaxy image still being made is waited for (it is made off the clock). */
const imagesReady = (vt: VirtualTime) => until(vt, () => [...document.querySelectorAll('.crt-image, .gcard-art img, .card-art img')].every((el) => !(el as HTMLElement).dataset || (el as HTMLElement).dataset['ready'] !== 'false'), 4000);
const click = (sel: string, text?: RegExp) => {
  const el = [...document.querySelectorAll<HTMLElement>(sel)].find((e) => !text || text.test(e.textContent ?? '') || text.test(e.getAttribute('aria-label') ?? ''));
  el?.click();
  return !!el;
};

// ---------- Fixtures ----------
const stationView: StationView = {
  rooms: [
    { id: 'scanner', state: 'working', level: 1, maxLevel: 1, next: null },
    { id: 'planetarium', state: 'working', level: 1, maxLevel: 1, next: null },
    { id: 'lab', state: 'working', level: 1, maxLevel: 1, next: null },
    { id: 'hangar', state: 'working', level: 1, maxLevel: 1, next: null },
    { id: 'collider', state: 'working', level: 1, maxLevel: 1, next: null },
    { id: 'comms', state: 'working', level: 1, maxLevel: 1, next: null },
    { id: 'refinery', state: 'working', level: 3, maxLevel: 5, next: { cost: { components: 140, coins: 2400 } } },
    { id: 'antenna', state: 'working', level: 2, maxLevel: 5, next: { cost: { components: 60, coins: 900 } } },
    { id: 'archive', state: 'working', level: 1, maxLevel: 1, next: null },
    { id: 'trophies', state: 'working', level: 1, maxLevel: 1, next: null },
  ],
  refinery: { level: 3, rate: 45, capacity: 220, queue: 96, ready: 38, nextAt: '2026-11-12T19:03:00.000Z' },
  antenna: { level: 2, rate: 6, capHours: 8, accrued: 14, fullAt: '2026-11-12T23:00:00.000Z' },
  wallet: { coins: 18_420, dust: 1_260, signal: 24, material: 645, components: 182 },
};

const labCfg = parseConfig('lab', {});
const labLevels: Record<string, number> = { hull: 3, targeting: 1, resonance: 2, recycling: 1, throughput: 5, silos: 2, magnet: 1 };
const labView: LabView = {
  open: true,
  nodes: labCfg.nodes.map((n) => ({ id: n.id, branch: n.branch, name: n.name, effect: n.effect, per: n.per, requires: n.requires, ...labNodeStatus(n, labLevels, labCfg) })),
  effects: labEffects(labLevels, labCfg),
  wallet: { coins: 18_420, dust: 1_260, signal: 24, components: 182 },
};

const probeCard = (id: string, over: Partial<ProbeCard> = {}): ProbeCard => {
  const p = DEFAULT_CONTENT.probes.find((x) => x.id === id)!;
  const w = DEFAULT_CONTENT.weapons.find((x) => x.id === p.weapon)!;
  return { id, name: p.name, description: p.description, sprite: p.sprite, hp: p.hp, speed: p.speed, weapon: { id: w.id, name: w.name, icon: w.icon }, quirk: p.quirk ?? null, unlocked: true, condition: null, progress: 1, ...levelOne(p), ...over };
};
const sectorCard = (id: string, over: Partial<SectorCard> = {}): SectorCard => {
  const sec = DEFAULT_CONTENT.sectors.find((x) => x.id === id)!;
  const boss = DEFAULT_CONTENT.bosses.find((b) => b.id === sec.boss)!;
  const fauna = [...new Set(sec.spawns.map((sp) => sp.enemy))].map((e) => DEFAULT_CONTENT.enemies.find((x) => x.id === e)!);
  return { id, name: sec.name, description: sec.description, boss: { name: boss.name, title: boss.title, sprite: boss.sprite }, fauna: fauna.map((e) => ({ id: e.id, name: e.name, sprite: e.sprite })), layerSeconds: sec.layerSeconds, biome: sec.biome, unlocked: true, condition: null, progress: 1, season: sec.season, ...over };
};
const hangarView: HangarView = {
  sectors: ['outer-nebula', 'frost-rings', 'hollow-reef', 'broken-forge', 'signal-rift'].map((id) => sectorCard(id)),
  sector: 'outer-nebula',
  probes: ['lumen', 'bastion', 'spark', 'sentinel', 'anchor', 'prism', 'comet', 'echo'].map((id) => probeCard(id)),
  probe: 'lumen',
  test: { taken: true, probe: 'lumen' },
  slots: 4,
  maxSlots: 6,
  loadout: [galaxy(1, 4, 'holo'), galaxy(2, 3, 'prismatic'), galaxy(3, 2), null],
  daily: { playedSeconds: 1200, fullSecondsLeft: 3 * 3600 - 1200, multiplier: 1, fullHours: 3, resetsAt: '2026-11-12T23:00:00.000Z' },
  runsEnabled: true,
  nextSlot: { slot: 5, condition: { stat: 'runs', value: 40 }, progress: 0.7, dust: 400, ready: false },
} as HangarView;

const rates = [0.5, 0.28, 0.13, 0.06, 0.03];
const gachaView = (over: Partial<GachaView> = {}): GachaView => ({
  banners: [
    { id: 'deep-scan', kind: 'standard', name: 'Escáner profundo', currency: 'signal', nextRates: rates, sinceLegendary: 12, untilGuarantee: 8, welcome: false },
    { id: 'primer-contacto', kind: 'event', name: 'Escáner de Primer contacto', currency: 'signal:primer-contacto', featured: { trait: 'phenomenon', value: 'supernova' }, endsAt: '2026-11-23T23:00:00.000Z', nextRates: rates, sinceLegendary: 0, untilGuarantee: 20, welcome: false, untilFeatured: 31, featuredEvery: 45 },
  ],
  costs: { coins: 100, coinsTen: 900, signals: 1 },
  freePullAvailable: false,
  wallet: { coins: 18_420, dust: 1_260, signal: 24, 'signal:primer-contacto': 12 },
  leftovers: [],
  ...over,
});

const collectionPage = (): CollectionPage => {
  const items = Array.from({ length: 36 }, (_, i) => {
    const tier = [0, 1, 0, 2, 1, 0, 3, 1, 2, 0, 4, 1][i % 12]!;
    const finish = i % 11 === 3 ? 'holo' : i % 13 === 5 ? 'prismatic' : i % 17 === 8 ? 'braille' : 'normal';
    return galaxy(200 + i, tier, finish);
  });
  return { items, counts: { common: 12, uncommon: 9, rare: 6, epic: 6, legendary: 3 }, fusion: { count: 5, dust: [20, 50, 120, 300] } } as CollectionPage;
};

test(`pantalla ${SCENE}`, async () => {
  const vt = installVirtualTime();
  if (SCENE === 'station') {
    api({ 'GET /station': () => stationView, 'GET /gacha': () => gachaView() });
    mount('/estacion', createElement(StationScreen));
    await warm(vt);
    await record(vt, 'station', FRAMES || 360, (f) => {
      if (f === 190) click('button', /Refinería/);
    });
  }
  if (SCENE === 'lab') {
    api({ 'GET /lab': () => labView, 'GET /gacha': () => gachaView() });
    mount('/laboratorio', createElement(LabScreen));
    await warm(vt);
    await record(vt, 'lab', FRAMES || 240);
  }
  if (SCENE === 'lobby') {
    api({
      'GET /hangar': () => hangarView,
      'GET /gacha': () => gachaView(),
      'GET /auth/me': () => ({ id: 'a1', username: 'piloto_rayo', roles: [], mfa: false, level: 24 }),
      'GET /rooms': () => ({ mine: null, open: [], allowed: true, reason: null, minLevel: 1 }),
      'PUT /hangar/probe': (init) => ({ ...hangarView, probe: JSON.parse(String(init?.body ?? '{}')).probe ?? 'lumen' }),
      'PUT /hangar/sector': (init) => ({ ...hangarView, sector: JSON.parse(String(init?.body ?? '{}')).sector ?? 'outer-nebula' }),
    });
    mount('/incursion', createElement(HangarScreen));
    await warm(vt, 60);
    await record(vt, 'lobby', FRAMES || 420, (f) => {
      if (f === 70 || f === 140 || f === 210 || f === 280) click('button', /Sonda siguiente/);
      if (f === 340) click('.lobby-where button', /Forja Rota/);
    });
  }
  if (SCENE === 'scanner') {
    const pulls = [0, 1, 0, 2, 1, 0, 3, 1, 2, 4].map((tier, i) => galaxy(10 + i, tier, i === 9 ? 'holo' : i === 6 ? 'prismatic' : 'normal'));
    const response: PullResponse = { pulls, wallet: { coins: 18_420, dust: 1_260, signal: 14 }, view: gachaView({ wallet: { coins: 18_420, dust: 1_260, signal: 14 } }) };
    api({ 'GET /gacha': () => gachaView(), 'POST /gacha/pull': () => response });
    mount('/escaner', createElement(ScannerScreen));
    await warm(vt, 60);
    await record(vt, SKIP ? 'scanner-end' : 'scanner', FRAMES || 2100, async (f) => {
      if (f === 50) click('.pull-btn', /Escanear 10/);
      await imagesReady(vt);
    }, SKIP);
  }
  if (SCENE === 'event') {
    api({ 'GET /gacha': () => gachaView() });
    mount('/escaner?tipo=evento', createElement(ScannerScreen));
    await warm(vt, 60);
    await record(vt, 'event', FRAMES || 300);
  }
  if (SCENE === 'collection') {
    const page = collectionPage();
    api({ 'GET /galaxies': () => page, 'GET /gacha': () => gachaView(), 'GET /catalog/summary': () => ({ ready: 3, percent: 34 }) });
    mount('/coleccion', createElement(CollectionScreen));
    await warm(vt, 80);
    await until(vt, () => document.querySelectorAll('.gcard').length > 10);
    await record(vt, 'collection', FRAMES || 360, async (f) => {
      if (f > 90) window.scrollBy(0, 2);
      await imagesReady(vt);
    });
  }
  if (SCENE === 'inspector') {
    const g = galaxy(77, 4, 'holo');
    document.body.style.margin = '0';
    const host = document.createElement('div');
    document.body.appendChild(host);
    createRoot(host).render(createElement(Inspector, { galaxy: g, onClose: () => {} }));
    await warm(vt, 30);
    await until(vt, () => document.querySelector<HTMLElement>('.inspector')?.dataset['state'] === 'ready', 60_000);
    await warm(vt, 20);
    const canvas = () => document.querySelector<HTMLCanvasElement>('.inspector canvas');
    await record(vt, 'inspector', FRAMES || 360, (f) => {
      const c = canvas();
      if (!c) return;
      const r = c.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const opts = (dx: number) => ({ bubbles: true, clientX: x + dx, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 });
      // A slow drag to the right and back: the card turns and shows its back, then comes round.
      if (f === 10) c.dispatchEvent(new PointerEvent('pointerdown', opts(0)));
      if (f > 10 && f < 300) c.dispatchEvent(new PointerEvent('pointermove', opts((f - 10) * 2.2)));
      if (f === 300) c.dispatchEvent(new PointerEvent('pointerup', opts(640)));
    });
  }
});
