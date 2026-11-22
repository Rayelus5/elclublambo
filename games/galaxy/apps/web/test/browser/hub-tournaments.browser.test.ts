import { DEFAULT_CLOSING_TIERS, DEFAULT_PODIUM, type Leaderboard, type MeResponse, type TournamentCard, type TournamentList, type TournamentMe } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { GACHA_KEY } from '../../src/api/economy';
import { TitleScreen } from '../../src/hub/TitleScreen';
import '../../src/styles/app.css';
import fredokaUrl from '../../public/fonts/fredoka-latin.woff2?url';

// The title screen's right column in a real Chromium: the season panel and, under it, the tournaments panel, the two
// as tall as the menu beside them at the usual desktop sizes, with nothing sideways. VITE_HUB_SHOTS=1 saves shots.

const shots = Boolean(import.meta.env['VITE_HUB_SHOTS']);
const SIZES = [
  [1280, 720],
  [1366, 768],
  [1536, 864],
  [1920, 1080],
  [2560, 1440],
] as const;
const DAY = 86_400_000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const me: MeResponse = { id: 'a1', username: 'sonda_rayo', roles: [], mfa: false, level: 18 };

async function gameFonts() {
  if (![...document.fonts].some((f) => f.family === 'Fredoka' && f.status === 'loaded')) {
    const face = new FontFace('Fredoka', `url(${fredokaUrl})`, { weight: '300 700' });
    document.fonts.add(face);
    await face.load();
  }
  await document.fonts.ready;
}

const banner = (a: string, b: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600"><defs><radialGradient id="g" cx="72%" cy="40%" r="70%"><stop offset="0" stop-color="${a}"/><stop offset=".45" stop-color="${b}"/><stop offset="1" stop-color="#05060f"/></radialGradient></defs><rect width="1600" height="600" fill="url(#g)"/>${Array.from({ length: 90 }, (_, i) => `<circle cx="${(i * 137) % 1600}" cy="${(i * 89) % 600}" r="${1 + (i % 3)}" fill="#fff" opacity="${0.3 + (i % 5) / 8}"/>`).join('')}</svg>`,
  )}`;
const mine = (over: Partial<TournamentMe> = {}): TournamentMe => ({ status: 'joined', joinedAt: at(-DAY), rank: 7, score: 4_860, runs: 9, eligible: true, rewards: null, claimed: false, refunded: false, reason: null, ...over });
const prizes: TournamentCard['prizes'] = [
  { from: 1, to: 1, gifts: [{ kind: 'currency', currency: 'coins', amount: 25_000 }, { kind: 'galaxy', tier: 'legendary', finish: 'holo', trait: null, count: 1 }], cash: { amountEur: 50, note: '' } },
  { from: 2, to: 3, gifts: [{ kind: 'currency', currency: 'coins', amount: 12_000 }], cash: null },
  { from: 4, to: 10, gifts: [{ kind: 'currency', currency: 'dust', amount: 3_000 }], cash: null },
];
const card = (over: Partial<TournamentCard> = {}): TournamentCard => ({
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'copa-de-hielo',
  title: 'Copa de hielo',
  summary: 'Baja tan hondo como puedas en la Nebulosa y suma puntos con cada incursión que termines',
  seasonId: 'season-2',
  state: 'running',
  startsAt: at(-2 * DAY),
  endsAt: at(4 * DAY + 6 * 3_600_000),
  resultsAt: null,
  banner: banner('#6fe3ff', '#26389a'),
  exclusive: true,
  metric: 'points',
  filters: { sector: null, probe: null, mode: 'any', minLevel: null },
  entry: null,
  prizes,
  participation: { minRuns: 5, gifts: [{ kind: 'currency', currency: 'dust', amount: 500 }] },
  entrants: 214,
  maxEntrants: null,
  me: mine(),
  join: { open: false, block: 'joined' },
  exclusiveWith: null,
  ...over,
});
const LISTS: Record<string, TournamentList> = {
  dentro: {
    running: [
      card(),
      card({ id: '2', slug: 'caza-de-nucleos', title: 'Caza de Núcleos', metric: 'cores', banner: null, exclusive: false, me: null, join: { open: true, block: null }, entrants: 88, maxEntrants: 120 }),
    ],
    upcoming: [card({ id: '4', slug: 'copa-de-fuego', title: 'Copa de fuego', state: 'scheduled', startsAt: at(5 * DAY), endsAt: at(10 * DAY), me: null, join: { open: true, block: null }, entry: { currency: 'coins', amount: 500 }, banner: null, entrants: 31, maxEntrants: 200 })],
    finished: [],
    now: new Date().toISOString(),
  },
  abierto: {
    running: [card({ me: null, join: { open: true, block: null }, entry: { currency: 'coins', amount: 500 }, prizes: prizes.map((p) => ({ ...p, cash: null })) })],
    upcoming: [],
    finished: [],
    now: new Date().toISOString(),
  },
  premio: {
    running: [],
    upcoming: [card({ id: '4', slug: 'copa-de-fuego', title: 'Copa de fuego', state: 'scheduled', startsAt: at(5 * DAY), endsAt: at(10 * DAY), me: null, join: { open: true, block: null }, banner: null })],
    finished: [card({ id: '5', slug: 'copa-de-otono', title: 'Copa de otoño', state: 'finished', startsAt: at(-12 * DAY), endsAt: at(-5 * DAY), resultsAt: at(-4 * DAY), banner: banner('#b39dff', '#3a2a9a'), me: mine({ rank: 2, score: 9_100, rewards: { place: 2, gifts: prizes[1]!.gifts, cash: null, participation: false } }), join: { open: false, block: 'closed' } })],
    now: new Date().toISOString(),
  },
  ninguno: { running: [], upcoming: [], finished: [], now: new Date().toISOString() },
};

const NAMES = ['vega', 'lyra_nova', 'altair', 'deneb', 'rigel_23', 'sirius', 'sonda_rayo', 'betelgeuse_x'];
const rows = NAMES.map((username, i) => ({ rank: i + 1, username, level: 30 - i, value: 31_500 - i * 1450, runs: 120 - i * 5, bestDepth: 14 - i, avatar: null, frame: null }));
const board: Leaderboard = {
  season: { id: 'season-2', name: 'Temporada 2', startsAt: at(-DAY), endsAt: at(27 * DAY), tiers: [500, 2000, 6000, 15000, 30000], closing: { tiers: [...DEFAULT_CLOSING_TIERS], podium: DEFAULT_PODIUM, podiumSize: 3 } },
  tab: 'general',
  rows,
  me: rows[6]!,
  total: 412,
};

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  document.body.classList.remove('ready', 'settled');
  vi.unstubAllGlobals();
});

function mount(list: TournamentList) {
  const routes: Record<string, unknown> = { '/leaderboard?tab=general': board, '/tournaments': list };
  vi.stubGlobal('fetch', (url: string) => {
    const key = Object.keys(routes).find((k) => String(url).endsWith(k));
    // Everything else stays loading, as on a slow line: the column must hold its shape meanwhile too.
    if (!key) return new Promise(() => {});
    return Promise.resolve(new Response(JSON.stringify(routes[key]), { status: 200, headers: { 'content-type': 'application/json' } }));
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(GACHA_KEY, { banners: [], costs: { coins: 100, coinsFive: 475, coinsTen: 900, signals: 1 }, freePullAvailable: false, wallet: { coins: 18_450, dust: 2_310, signal: 7 }, shop: { open: false, offer: false } });
  const host = document.createElement('div');
  host.id = 'root';
  document.body.style.margin = '0';
  document.body.append(host);
  root = createRoot(host);
  flushSync(() =>
    root!.render(
      createElement(QueryClientProvider, { client }, createElement(MemoryRouter, { initialEntries: ['/'] }, createElement(Routes, null, createElement(Route, { path: '*', element: createElement(TitleScreen, { me }) })))),
    ),
  );
}

async function settle(list: TournamentList) {
  mount(list);
  document.body.classList.add('ready', 'settled');
  await gameFonts();
  await expect.poll(() => document.querySelector('.season-summary .podium')).not.toBeNull();
  await expect.poll(() => document.querySelector('.hub-tn .htn-main, .hub-tn .htn-empty:not([role])')).not.toBeNull();
  // The panels come in one after another (.enter): wait for the last one.
  await wait(1700);
}

for (const [w, h] of SIZES) {
  test(`la temporada y los torneos ocupan la columna de la derecha a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    await settle(LISTS['dentro']!);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    const main = document.querySelector('.hub-main')!.getBoundingClientRect();
    const season = document.querySelector('.season-summary')!.getBoundingClientRect();
    const panel = document.querySelector<HTMLElement>('.hub-tn')!;
    const box = panel.getBoundingClientRect();
    const hub = document.querySelector<HTMLElement>('.hub')!;
    // Under the season, inside its column, and down to the menu's foot: the two together as tall as the menu.
    expect(box.top).toBeGreaterThan(season.bottom);
    expect(Math.abs(box.left - season.left)).toBeLessThan(1);
    expect(Math.abs(box.right - season.right)).toBeLessThan(1);
    expect(Math.abs(box.bottom - main.bottom)).toBeLessThan(2);
    expect(box.height).toBeGreaterThanOrEqual(68);
    // The home never scrolls for it (1280×720 scrolled its 17 px before the panel).
    expect(hub.scrollHeight - hub.clientHeight).toBeLessThanOrEqual(h <= 720 ? 18 : 0);
    // Its title and «Ver todos» are whole and inside it.
    const name = panel.querySelector<HTMLElement>('.htn-name')!.getBoundingClientRect();
    const all = panel.querySelector<HTMLElement>('.htn-all')!.getBoundingClientRect();
    for (const r of [name, all]) {
      expect(r.left).toBeGreaterThanOrEqual(box.left);
      expect(r.right).toBeLessThanOrEqual(box.right + 0.5);
      expect(r.bottom).toBeLessThanOrEqual(box.bottom + 0.5);
    }
    expect(all.right).toBeLessThanOrEqual(box.right - 6);
    expect(all.height).toBeGreaterThanOrEqual(34);
    expect(panel.querySelector('.htn-go')!.getAttribute('href')).toBe('/torneos/copa-de-hielo');
    // Jugar has nothing on its corner any more.
    expect(document.querySelector('.hub-tournaments, .play-slot')).toBeNull();
    if (shots) await page.screenshot({ path: `__shots__/hub-${w}.png` });
  }, 30_000);
}

const STATES: [string, string, string][] = [
  ['abierto', 'Inscríbete', 'Inscripción abierta, 214 inscritos'],
  ['premio', 'Recoger premios', 'Quedaste 2.º con 9100 puntos'],
  ['ninguno', '', 'Ningún torneo a la vista. Vuelve pronto'],
];
for (const [name, cta, line] of STATES) {
  for (const [w, h] of [
    [1280, 720],
    [1920, 1080],
  ] as const) {
    test(`el panel de torneos ${name} a ${w}×${h}`, async () => {
      await page.viewport(w, h);
      await settle(LISTS[name]!);
      const panel = document.querySelector<HTMLElement>('.hub-tn')!;
      expect(panel.textContent).toContain(line);
      if (cta) expect(panel.querySelector('.htn-go')!.textContent).toContain(cta);
      expect(panel.classList.contains('p-collect')).toBe(name === 'premio');
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
      if (shots) await page.screenshot({ path: `__shots__/hub-${name}-${w}.png` });
    }, 45_000);
  }
}
