import { type AdminPopup, type AdminPopupResults, CONFIG_KEYS, type MeResponse, parseConfig, type PopupRecord, type PopupTextsPage } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { AdminLayout } from '../../src/admin/AdminLayout';
import { PopupPage } from '../../src/admin/popups/PopupPage';
import { PopupResults } from '../../src/admin/popups/PopupResults';
import { PopupsScreen } from '../../src/admin/popups/PopupsScreen';
import { copy } from '../../src/copy/es';
import '../../src/styles/app.css';
import bungeeUrl from '../../public/fonts/bungee-latin.woff2?url';
import fredokaUrl from '../../public/fonts/fredoka-latin.woff2?url';

// «Encuestas y avisos» in the panel, in a real Chromium (plan 2026-11-22, part A): the list by state, every step of the
// wizard on a rich form (a scale about a Core, a choice, a text, a reward) and a promotion's image and «Ver más», the
// review's «Así lo verá el jugador» at its three screen widths, and the results with the NPS, the bars and the texts.
// The page never grows sideways at any desktop width, and the preview never spills out of its frame.
// VITE_ADMIN_POPUP_SHOTS=1 saves the shots in __shots__/.

const t = copy.admin.popups;
const shots = Boolean(import.meta.env['VITE_ADMIN_POPUP_SHOTS']);
const me: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };
const DAY = 86_400_000;
const around = (d: number) => new Date(Date.now() + d * DAY).toISOString();
const id = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const IMAGE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const keys = CONFIG_KEYS.map((key) => (key === 'content' ? { key, version: 1, createdAt: null, author: null, note: null, lazy: true } : { key, version: 1, data: parseConfig(key, {}), createdAt: null, author: null, note: null }));

/** An image for the uploaded one (a nebula with a probe's trail, as an SVG: nothing to fetch). */
const art = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><defs><radialGradient id="g" cx="62%" cy="42%" r="70%"><stop offset="0" stop-color="#ff9a3c"/><stop offset=".35" stop-color="#7259ee"/><stop offset=".7" stop-color="#181a3d"/><stop offset="1" stop-color="#05060f"/></radialGradient></defs><rect width="1600" height="900" fill="url(#g)"/>${Array.from({ length: 140 }, (_, i) => `<circle cx="${(i * 137) % 1600}" cy="${(i * 89) % 900}" r="${1 + (i % 3)}" fill="#fff" opacity="${0.25 + (i % 5) / 8}"/>`).join('')}<path d="M180 760 Q 700 520 1180 300" stroke="#ffc94a" stroke-width="10" fill="none" stroke-linecap="round" opacity=".85"/><circle cx="1180" cy="300" r="22" fill="#ffc94a"/></svg>`,
)}`;

const base = (over: Partial<PopupRecord> = {}): PopupRecord => ({
  kind: 'survey',
  title: 'Tu opinión cuenta',
  body: '',
  questions: [{ type: 'scale', id: 'q1', prompt: '¿Recomendarías Galaxy Survivor a un amigo?', range: '0-10', low: 'Poco probable', high: 'Muy probable', subject: null }],
  imageMedia: null,
  link: null,
  audience: { kind: 'all' },
  startsAt: around(1),
  endsAt: around(8),
  priority: 1,
  reward: [],
  ...over,
});
const form = base({
  kind: 'form',
  title: 'Tu partida ideal',
  body: 'Tres preguntas rápidas para preparar la próxima temporada',
  imageMedia: IMAGE,
  audience: { kind: 'segment', minLevel: 10 },
  priority: 2,
  reward: [
    { kind: 'currency', currency: 'coins', amount: 500 },
    { kind: 'currency', currency: 'dust', amount: 120 },
  ],
  questions: [
    { type: 'scale', id: 'q1', prompt: '¿Qué te parece la dificultad de este Núcleo?', range: '1-5', low: 'Muy fácil', high: 'Muy difícil', subject: { kind: 'boss', id: 'hive' } },
    {
      type: 'choice',
      id: 'q2',
      prompt: '¿Qué es lo que más te gusta del juego?',
      multi: true,
      options: [
        { id: 'o1', label: 'El escáner y las galaxias' },
        { id: 'o2', label: 'Las incursiones' },
        { id: 'o3', label: 'Los clanes' },
        { id: 'o4', label: 'Los torneos' },
      ],
    },
    { type: 'text', id: 'q3', prompt: '¿Qué añadirías?', placeholder: 'Escribe aquí', required: false, maxLength: 500 },
  ],
});
const promotion = base({
  kind: 'promotion',
  title: 'Copa de hielo',
  body: 'El primer torneo de la temporada ya está aquí. Baja tan hondo como puedas en la Nebulosa, suma puntos con cada incursión que termines y pelea por una galaxia legendaria con acabado holo. Los diez mejores se llevan monedas y polvo estelar.',
  questions: [],
  imageMedia: IMAGE,
  link: { kind: 'route', to: '/temporada', label: 'Ver el torneo' },
});
const popup = (n: number, state: AdminPopup['state'], record: PopupRecord, over: Partial<AdminPopup> = {}): AdminPopup => ({
  id: id(n),
  state,
  version: 2,
  record,
  createdAt: around(-3),
  createdBy: 'ad1',
  updatedAt: around(-1),
  updatedBy: 'ad1',
  publishedAt: state === 'draft' ? null : around(-2),
  publishedBy: state === 'draft' ? null : 'ad1',
  endedAt: null,
  endedBy: null,
  counts: { seen: 0, answered: 0, clicked: 0 },
  bigReasons: [],
  ...over,
});
const list = [
  popup(1, 'draft', form, { bigReasons: ['recipients'] }),
  popup(2, 'draft', promotion),
  popup(3, 'scheduled', base({ title: 'Dificultad de los enemigos', startsAt: around(2), endsAt: around(9), questions: [{ type: 'scale', id: 'q1', prompt: '¿Qué te parece la dificultad de este enemigo?', range: '1-5', low: 'Muy fácil', high: 'Muy difícil', subject: { kind: 'enemy', id: 'mite' } }] })),
  popup(4, 'live', base({ startsAt: around(-2), endsAt: around(5), audience: { kind: 'segment', usernames: ['orion', 'lyra', 'vega'] } }), { counts: { seen: 1240, answered: 512, clicked: 0 } }),
  popup(5, 'ended', { ...promotion, startsAt: around(-12), endsAt: around(-5) }, { counts: { seen: 3980, answered: 0, clicked: 870 } }),
];
const texts = ['Más sectores y un modo historia', 'Que los clanes puedan hacer incursiones juntos', 'Un mercado con subastas', 'Más skins para las sondas, sobre todo de temporada', 'Logros secretos'];
const page50 = (from: number): PopupTextsPage => ({
  question: 'q3',
  texts: Array.from({ length: 8 }, (_, i) => ({ username: ['orion', 'lyra', 'vega', 'rigel', 'altair', 'deneb', 'mira', 'sirius'][i]!, text: texts[(from + i) % texts.length]!, at: around(-(from + i) / 30) })),
  total: 173,
  next: '901',
});
const results: AdminPopupResults = {
  popup: popup(4, 'live', { ...form, startsAt: around(-2), endsAt: around(5), questions: [base().questions[0]!, form.questions[1]!, form.questions[2]!] }, { counts: { seen: 1240, answered: 512, clicked: 0 } }),
  totals: { seen: 1240, answered: 512, later: 388, exhausted: 96, rewarded: 470, closed: 0, clicked: 0 },
  questions: [
    (() => {
      const counts = [6, 3, 5, 8, 10, 22, 34, 71, 98, 120, 135];
      const n = counts.reduce((s, c) => s + c, 0);
      return { type: 'scale' as const, id: 'q1', range: '0-10' as const, n, buckets: counts.map((c, v) => ({ value: v, count: c, pct: (c * 100) / n })), average: counts.reduce((s, c, v) => s + c * v, 0) / n, nps: { score: ((255 - 88) * 100) / n, promoters: 255, passives: 169, detractors: 88 }, topBox: null };
    })(),
    { type: 'choice', id: 'q2', multi: true, n: 498, options: [{ id: 'o2', label: 'Las incursiones', count: 401, pct: 80.5 }, { id: 'o1', label: 'El escáner y las galaxias', count: 377, pct: 75.7 }, { id: 'o4', label: 'Los torneos', count: 190, pct: 38.2 }, { id: 'o3', label: 'Los clanes', count: 122, pct: 24.5 }] },
    { type: 'text', id: 'q3', n: 173 },
  ],
};

function respond(url: string, init?: RequestInit): Response {
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  const path = url.replace(/^\/galaxy\/api/, '');
  if (path === '/auth/me') return json(me);
  if (path === '/admin/config/keys') return json(keys);
  if (path === '/content') return json({ error: 'internal' }, 503);
  if (path === '/profile/cosmetics') return json({});
  if (path === '/admin/media') return json({ assets: [{ id: IMAGE, name: 'copa-de-hielo.png', mime: 'image/png', bytes: 120_000, width: 1600, height: 900, createdAt: around(-4), uses: 1 }], totalBytes: 120_000 });
  if (path === '/admin/mail/preview') return json({ recipients: 1873 });
  if (path === '/admin/popups') return json({ popups: list, now: new Date().toISOString() });
  // A reward for everyone is past the mail's limits: the note says why (this admin is a superadmin).
  if (path === '/admin/popups/validate' && init?.method === 'POST') return json({ ok: true, issues: [], bigReasons: (JSON.parse(String(init.body)) as { record: PopupRecord }).record.reward.length ? ['recipients'] : [] });
  if (/\/results$/.test(path)) return json(results);
  if (/\/texts\?/.test(path)) return json(page50(0));
  const one = /^\/admin\/popups\/([^/]+)$/.exec(path);
  if (one) return json(list.find((x) => x.id === one[1]) ?? list[0]);
  return json({});
}

async function gameFonts() {
  for (const [family, url] of [
    ['Fredoka', fredokaUrl],
    ['Bungee', bungeeUrl],
  ] as const) {
    if ([...document.fonts].some((f) => f.family === family && f.status === 'loaded')) continue;
    const face = new FontFace(family, `url(${url})`, family === 'Fredoka' ? { weight: '300 700' } : {});
    document.fonts.add(face);
    await face.load();
  }
  await document.fonts.ready;
}

let root: Root | null = null;
let images: MutationObserver | null = null;
beforeEach(async () => {
  await gameFonts();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => respond(url, init)));
  // Uploaded images are served by the game's server: here, the nebula stands in for them.
  const swap = (el: Element) => el.querySelectorAll<HTMLImageElement>('img[src^="/galaxy/api/media/"]').forEach((img) => img.setAttribute('src', art));
  images = new MutationObserver(() => swap(document.body));
  images.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
});
afterEach(() => {
  images?.disconnect();
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const shot = async (name: string, w: number) => {
  if (shots) await page.screenshot({ path: `__shots__/admin-encuestas-${name}-${w}.png` });
};
const noSideways = (w: number) => expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
const button = (re: RegExp) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => re.test(b.textContent ?? ''))!;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mount(path: string) {
  root?.unmount();
  document.body.innerHTML = '';
  document.body.style.margin = '0';
  const host = document.createElement('div');
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
          createElement(
            Route,
            { path: '/admin', element: createElement(AdminLayout) },
            createElement(Route, { path: 'encuestas', element: createElement(PopupsScreen) }),
            createElement(Route, { path: 'encuestas/:id', element: createElement(PopupPage) }),
            createElement(Route, { path: 'encuestas/:id/resultados', element: createElement(PopupResults) }),
          ),
        ),
      ),
    ),
  );
}

/** The preview: its stage stays inside its frame, and the popup inside the stage. */
function previewFits() {
  const frame = document.querySelector('.apop-frame')!.getBoundingClientRect();
  const stage = document.querySelector('.apop-stage')!.getBoundingClientRect();
  expect(stage.width).toBeLessThanOrEqual(frame.width + 1);
  expect(Math.abs(stage.left - frame.left - (frame.right - stage.right))).toBeLessThan(2);
  expect(Math.abs(stage.height - frame.height)).toBeLessThan(2);
  // The popup stays inside its screen (the round «Ver más» rides on the box's corner, a little outside it).
  const box = document.querySelector('.apop-stage .pop')!.getBoundingClientRect();
  expect(box.left).toBeGreaterThanOrEqual(stage.left - 1);
  expect(box.right).toBeLessThanOrEqual(stage.right + 1);
  expect(box.top).toBeGreaterThanOrEqual(stage.top - 1);
  expect(box.bottom).toBeLessThanOrEqual(stage.bottom + 1);
}

/** The list and the review of a draft with the player's popup at its three widths. */
for (const [w, h] of [
  [1280, 720],
  [1920, 1080],
  [2560, 1440],
] as const) {
  test(`lista y revisión a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    mount('/admin/encuestas');
    await expect.poll(() => document.querySelectorAll('.apop-card').length, { timeout: 8000 }).toBe(list.length);
    noSideways(w);
    await shot('lista', w);

    mount(`/admin/encuestas/${id(1)}?paso=revision`);
    await expect.poll(() => document.querySelector('.apop-stage .pop'), { timeout: 8000 }).not.toBeNull();
    for (const screen of ['1280', '1920', '2560'] as const) {
      await userEvent.click(document.querySelector<HTMLElement>(`.apop-preview-head [data-value="${screen}"]`)!);
      await expect.poll(() => document.querySelector('.apop-stage')?.getAttribute('data-w')).toBe(screen);
      await wait(600);
      document.querySelector('.apop-preview')!.scrollIntoView({ block: 'start' });
      noSideways(w);
      previewFits();
      await shot(`revision-${screen}`, w);
    }
  }, 90_000);
}

/** Every step of the wizard on a rich form, and a promotion's image and «Ver más». */
for (const [w, h] of [
  [1280, 720],
  [1920, 1080],
] as const) {
  test(`asistente a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    mount(`/admin/encuestas/${id(1)}`);
    await expect.poll(() => document.querySelector('.apop-kinds'), { timeout: 8000 }).not.toBeNull();
    noSideways(w);
    await shot('paso-tipo', w);
    for (const [step, name] of [
      [t.steps.questions, 'preguntas'],
      [t.steps.media, 'imagen'],
      [t.steps.audience, 'publico'],
      [t.steps.reward, 'premio'],
    ] as const) {
      await userEvent.click(button(new RegExp(`^\\d?${step}`)));
      await expect.poll(() => document.querySelector('.ev-step-body > h2')?.textContent).toBe(step);
      window.scrollTo(0, 0);
      await wait(150);
      noSideways(w);
      await shot(`paso-${name}`, w);
      if (name === 'preguntas') {
        document.querySelectorAll('.apop-question')[2]!.scrollIntoView({ block: 'end' });
        await shot('paso-preguntas-abajo', w);
      }
    }
    // A promotion: its image and «Ver más», and its review.
    mount(`/admin/encuestas/${id(2)}?paso=imagen`);
    await expect.poll(() => document.querySelector('.admin-link'), { timeout: 8000 }).not.toBeNull();
    await wait(150);
    noSideways(w);
    await shot('promocion-imagen', w);
    await userEvent.click(button(new RegExp(`^\\d?${t.steps.review}`)));
    await expect.poll(() => document.querySelector('.apop-stage .pop-promo')).not.toBeNull();
    await wait(600);
    document.querySelector('.apop-preview')!.scrollIntoView({ block: 'start' });
    noSideways(w);
    previewFits();
    await shot('promocion-revision', w);
  }, 90_000);
}

/** The results: the tiles, the NPS, a choice's bars and the texts. */
for (const [w, h] of [
  [1280, 720],
  [1920, 1080],
] as const) {
  test(`resultados a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    mount(`/admin/encuestas/${id(4)}/resultados`);
    await expect.poll(() => document.querySelectorAll('.apop-result').length, { timeout: 8000 }).toBe(3);
    await expect.poll(() => document.querySelectorAll('.apop-texts li').length).toBe(8);
    expect(document.querySelector('.apop-nps-bar')!.children).toHaveLength(3);
    noSideways(w);
    await shot('resultados', w);
    document.querySelectorAll('.apop-result')[1]!.scrollIntoView({ block: 'start' });
    noSideways(w);
    await shot('resultados-opciones', w);
    document.querySelector('.apop-texts')!.scrollIntoView({ block: 'end' });
    await shot('resultados-textos', w);
  }, 60_000);
}
