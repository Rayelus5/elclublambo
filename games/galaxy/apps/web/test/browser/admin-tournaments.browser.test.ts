import { type AdminSeason, type AdminTournament, type AdminTournamentReview, CONFIG_KEYS, type MeResponse, parseConfig, type TournamentRecord } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { AdminLayout } from '../../src/admin/AdminLayout';
import { TournamentPage } from '../../src/admin/tournaments/TournamentPage';
import { TournamentsScreen } from '../../src/admin/tournaments/TournamentsScreen';
import { copy } from '../../src/copy/es';
import '../../src/styles/app.css';

// Torneos in a real browser (plan «temporadas como fichas», part 5): the list by state with the money to pay, every
// step of the wizard on a rich draft (images, dates in their season, the measure cards, sign-up switches, prize ranges
// with gifts and money, the player's card) and the review panel with its ranking, checks, bulk decisions and «Publicar
// ya»; at four desktop widths the page never grows sideways. Screenshots with VITE_TOURNAMENT_SHOTS=1.

const t = copy.admin.tournaments;
const me: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };
const DAY = 86_400_000;
const around = (d: number) => new Date(Date.now() + d * DAY).toISOString();
const { id: _i, name: _n, startsAt: _s, endsAt: _e, ...rules } = parseConfig('season', {});
const season: AdminSeason = { id: 'season-2', name: 'Temporada 2', startsAt: around(-6), endsAt: around(22), state: 'scheduled', open: true, version: 1, rules, route: parseConfig('seasonRoute', {}), missions: [], lab: [] };
const mail = { packs: [{ id: 'podio', name: 'Podio', art: 'star', items: [{ kind: 'currency', currency: 'coins', amount: 2500 }, { kind: 'xp', amount: 600 }] }] };
const keys = CONFIG_KEYS.map((key) => (key === 'content' ? { key, version: 1, createdAt: null, author: null, note: null, lazy: true } : { key, version: 1, data: key === 'mail' ? parseConfig('mail', mail) : parseConfig(key, {}), createdAt: null, author: null, note: null }));
const content = { key: 'content', version: 1, data: parseConfig('content', DEFAULT_CONTENT), createdAt: null, author: null, note: null };

const record = (over: Partial<TournamentRecord> = {}): TournamentRecord => ({
  slug: 'copa',
  seasonId: 'season-2',
  title: 'Copa del Vacío',
  summary: 'Una semana para firmar tu mejor partida en la Nebulosa Exterior',
  rules: 'Cuenta tu mejor partida en solitario desde que te inscribes.\nLas partidas con premio se repiten en el servidor antes de pagar.\nSi te sales, pierdes tu puntuación y no puedes volver.',
  bannerMedia: null,
  detailsMedia: null,
  startsAt: around(2),
  endsAt: around(9),
  exclusive: true,
  metric: 'best_run',
  filters: { sector: 'outer-nebula', probe: null, mode: 'solo', minLevel: 10 },
  entry: null,
  prizes: [
    { from: 1, to: 1, gifts: [{ kind: 'currency', currency: 'coins', amount: 10_000 }, { kind: 'galaxy', tier: 'legendary', finish: 'holo', trait: null, count: 1 }, { kind: 'cosmetic', piece: 'frame', id: 'gold' }], cash: { amountEur: 100, note: 'Por Bizum o PayPal' } },
    { from: 2, to: 3, gifts: [{ kind: 'currency', currency: 'coins', amount: 5000 }, { kind: 'currency', currency: 'dust', amount: 2000 }], cash: null },
    { from: 4, to: 10, gifts: [{ kind: 'currency', currency: 'coins', amount: 1000 }], cash: null },
  ],
  participation: { minRuns: 5, gifts: [{ kind: 'currency', currency: 'dust', amount: 300 }] },
  reviewHours: 24,
  maxEntrants: 200,
  ...over,
});
const id = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const tournament = (n: number, state: AdminTournament['state'], over: Partial<AdminTournament> = {}, rec: Partial<TournamentRecord> = {}): AdminTournament => ({
  id: id(n),
  state,
  version: 2,
  record: record(rec),
  createdAt: around(-3),
  createdBy: 'rayelus',
  updatedAt: around(-1),
  updatedBy: 'rayelus',
  scheduledAt: null,
  scheduledBy: null,
  publishedAt: null,
  entrants: 0,
  left: 0,
  disqualified: 0,
  pending: 0,
  undecided: 0,
  cashPending: 0,
  bigReasons: [],
  simVersion: null,
  simChanged: false,
  simVersions: [],
  ...over,
});
const list = [
  tournament(1, 'draft', { bigReasons: ['cash'] }),
  tournament(2, 'scheduled', { entrants: 14 }, { title: 'Liga de Núcleos', slug: 'nucleos', metric: 'cores', summary: 'Vence todos los Núcleos que puedas', prizes: [{ from: 1, to: 3, gifts: [{ kind: 'currency', currency: 'coins', amount: 4000 }], cash: null }], entry: { currency: 'coins', amount: 500 }, participation: null, filters: { sector: null, probe: null, mode: 'any', minLevel: null } }),
  tournament(3, 'running', { entrants: 87, left: 4 }, { title: 'Carrera de extracciones', slug: 'extracciones', metric: 'extractions', startsAt: around(-3), endsAt: around(4), exclusive: false }),
  tournament(4, 'review', { entrants: 120, pending: 3, undecided: 5, disqualified: 1, simChanged: true, simVersion: '1.20.0', simVersions: ['1.19.0', '1.20.0'] }, { title: 'Gran Premio de otoño', slug: 'otono', startsAt: around(-8), endsAt: around(-0.5) }),
  tournament(5, 'finished', { entrants: 140, cashPending: 1, publishedAt: around(-5) }, { title: 'Copa de bienvenida', slug: 'bienvenida', startsAt: around(-14), endsAt: around(-7) }),
  tournament(6, 'cancelled', { entrants: 0 }, { title: 'Torneo de prueba', slug: 'prueba', startsAt: around(-20), endsAt: around(-15) }),
];
const cash = [
  { tournamentId: id(5), slug: 'bienvenida', title: 'Copa de bienvenida', username: 'orion', rank: 1, amountEur: 100, note: 'Por Bizum o PayPal', paidAt: null, paidBy: null },
  { tournamentId: id(5), slug: 'bienvenida', title: 'Copa de bienvenida', username: 'lyra', rank: 2, amountEur: 50, note: '', paidAt: around(-1), paidBy: 'rayelus' },
];
const names = ['orion', 'lyra', 'vega', 'rigel', 'altair', 'deneb', 'mira', 'sirius', 'nova', 'atlas', 'castor', 'polux'];
const review: AdminTournamentReview = {
  tournament: list[3]!,
  ranking: names.map((u, i) => {
    const place = i === 2 ? null : i < 2 ? i + 1 : i < 11 ? i : null;
    const rewards = place === null ? null : { place: place <= 10 ? place : null, gifts: record().prizes.find((p) => p.from <= place && place <= p.to)?.gifts ?? [], cash: place === 1 ? { amountEur: 100, note: '' } : null, participation: true };
    return { rank: i + 1, username: u, avatar: null, frame: null, score: 2400 - i * 137, eligible: i !== 2, place, runs: 12 - (i % 5), rewards };
  }),
  checks: [
    ...['orion', 'orion', 'lyra', 'vega', 'rigel'].map((u, i) => ({ runId: id(7).replace(/^7/, String(i)), username: u, finishedAt: around(-2 - i * 0.2), status: 'unverifiable' as const, detail: { reason: i < 3 ? 'sim_version' : 'inputs_missing' }, decision: null, decidedBy: null, decidedAt: null, checkedAt: around(-0.4), attempts: 1, current: true })),
    { runId: id(8), username: 'orion', finishedAt: around(-3), status: 'ok' as const, detail: { rows: [] }, decision: null, decidedBy: null, decidedAt: null, checkedAt: around(-0.4), attempts: 1, current: true },
    { runId: id(9), username: 'altair', finishedAt: around(-3), status: 'mismatch' as const, detail: { rows: [{ key: 'kills', saved: 940, replayed: 512, same: false }, { key: 'hash', saved: 'a1', replayed: 'b2', same: false }] }, decision: null, decidedBy: null, decidedAt: null, checkedAt: around(-0.4), attempts: 1, current: true },
    { runId: id(2), username: 'deneb', finishedAt: around(-3.5), status: 'pending' as const, detail: null, decision: null, decidedBy: null, decidedAt: null, checkedAt: null, attempts: 0, current: true },
    { runId: id(3), username: 'mira', finishedAt: around(-4), status: 'unverifiable' as const, detail: { reason: 'sim_version' }, decision: 'accept' as const, decidedBy: 'rayelus', decidedAt: around(-0.2), checkedAt: around(-0.4), attempts: 1, current: false },
  ],
  disqualified: [{ username: 'sirius', reason: 'Cuenta compartida con otro jugador' }],
  publishAt: around(0.5),
  canPublish: false,
  blocking: 6,
  unverifiable: {
    byReason: [
      { reason: 'sim_version', count: 3, blocking: 2 },
      { reason: 'inputs_missing', count: 2, blocking: 2 },
    ],
    byPlayer: [
      { username: 'orion', count: 2, blocking: 2 },
      { username: 'lyra', count: 1, blocking: 1 },
      { username: 'vega', count: 1, blocking: 1 },
      { username: 'rigel', count: 1, blocking: 0 },
    ],
  },
  cash: [],
};

function respond(url: string, init?: RequestInit): Response {
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  const path = url.replace(/^\/galaxy\/api/, '');
  if (path === '/auth/me') return json(me);
  if (path === '/admin/config/keys') return json(keys);
  if (path === '/admin/config/content') return json(content);
  if (path === '/content') return json({ error: 'internal' }, 503);
  if (path === '/admin/seasons') return json({ seasons: [season], now: new Date().toISOString(), warnings: [] });
  if (path === '/admin/media') return json({ assets: [], totalBytes: 0 });
  if (path === '/admin/tournaments') return json({ tournaments: list, now: new Date().toISOString() });
  if (path === '/admin/tournaments/cash') return json({ cash });
  if (path === '/admin/tournaments/validate' && init?.method === 'POST') return json({ ok: true, issues: [], bigReasons: ['cash'] });
  const review_ = /^\/admin\/tournaments\/([^/]+)\/review$/.exec(path);
  if (review_) return json(review);
  const one = /^\/admin\/tournaments\/([^/]+)$/.exec(path);
  if (one) return json(list.find((x) => x.id === one[1]) ?? list[0]);
  return json({});
}

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const shot = async (name: string, w: number) => {
  if (import.meta.env['VITE_TOURNAMENT_SHOTS']) await page.screenshot({ path: `__shots__/admin-torneos-${name}-${w}.png` });
};
const noSideways = (w: number) => expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
const button = (re: RegExp) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => re.test(b.textContent ?? ''))!;

function mount(path: string) {
  root?.unmount();
  document.body.innerHTML = '';
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
        { initialEntries: [path] },
        createElement(
          Routes,
          null,
          createElement(Route, { path: '/admin', element: createElement(AdminLayout) }, createElement(Route, { path: 'torneos', element: createElement(TournamentsScreen) }), createElement(Route, { path: 'torneos/:id', element: createElement(TournamentPage) })),
        ),
      ),
    ),
  );
}

for (const [w, h] of [
  [1280, 720],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
] as const) {
  test(`torneos a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => respond(url, init)));

    // The list, with the money to pay first.
    mount('/admin/torneos');
    await expect.poll(() => document.querySelectorAll('.tn-list-card').length, { timeout: 8000 }).toBe(list.length);
    expect(document.querySelector('.tn-cash')).not.toBeNull();
    noSideways(w);
    await shot('lista', w);
    document.querySelector('.ev-group:last-of-type')!.scrollIntoView();
    noSideways(w);
    await shot('lista-abajo', w);

    // Every step of the wizard on a rich draft.
    mount(`/admin/torneos/${id(1)}`);
    await expect.poll(() => document.querySelector('#tw-title'), { timeout: 8000 }).not.toBeNull();
    noSideways(w);
    await shot('paso-datos', w);
    for (const [step, name] of [
      [t.steps.dates, 'fechas'],
      [t.steps.metric, 'como-se-gana'],
      [t.steps.entry, 'inscripcion'],
      [t.steps.prizes, 'premios'],
    ] as const) {
      await userEvent.click(button(new RegExp(`^\\d?${step}`)));
      await expect.poll(() => document.querySelector('.ev-step-body > h2')?.textContent).toBe(step);
      window.scrollTo(0, 0);
      noSideways(w);
      await shot(`paso-${name}`, w);
    }
    // A prize's gifts in the mail's own picker.
    await userEvent.click(button(new RegExp(`^${t.chooseGifts}`)));
    await expect.poll(() => document.querySelector('.tn-gift-dialog .gift-picker'), { timeout: 5000 }).not.toBeNull();
    noSideways(w);
    await shot('regalos', w);
    await userEvent.click(button(new RegExp(`^${t.giftsDone}$`)));
    await userEvent.click(button(new RegExp(`^\\d?${t.steps.review}`)));
    await expect.poll(() => document.querySelector('.tn-card')).not.toBeNull();
    window.scrollTo(0, 0);
    noSideways(w);
    await shot('paso-revision', w);
    document.querySelector('.tn-preview')!.scrollIntoView();
    await shot('paso-revision-tarjeta', w);

    // The review panel.
    mount(`/admin/torneos/${id(4)}`);
    await expect.poll(() => document.querySelectorAll('.tn-ranking tbody tr').length, { timeout: 8000 }).toBe(names.length);
    expect(document.querySelector('.tn-bulk')).not.toBeNull();
    noSideways(w);
    await shot('revision', w);
    document.querySelector('.tn-checks')!.scrollIntoView();
    noSideways(w);
    await shot('revision-comprobaciones', w);
  }, 120_000);
}
