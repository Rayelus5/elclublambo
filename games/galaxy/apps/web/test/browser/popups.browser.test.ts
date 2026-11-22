import type { MeResponse, PopupView } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { GACHA_KEY } from '../../src/api/economy';
import { TitleScreen } from '../../src/hub/TitleScreen';
import { POPUP_SESSION_KEY } from '../../src/popups/PopupHost';
import { resetPrefs, setPrefs } from '../../src/settings/prefs';
import '../../src/styles/app.css';
import bungeeUrl from '../../public/fonts/bungee-latin.woff2?url';
import fredokaUrl from '../../public/fonts/fredoka-latin.woff2?url';

// «Encuestas y avisos» (plan 2026-11-22, part A) in a real Chromium, over the real title screen: the bare survey of the
// owner's mock-ups (1 to 5, and 0 to 10 with a Core drawn), a promotion whose long text fades out, a review with its
// stars and text, and a form on its second question of three. At every desktop size nothing goes sideways, the box
// stays inside the window (a quarter bigger from 2560 px, as the home), and the focus starts in the answer.
// VITE_POPUP_SHOTS=1 saves the shots in __shots__/.

const shots = Boolean(import.meta.env['VITE_POPUP_SHOTS']);
const SIZES = [
  [1280, 720],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
] as const;
const ID = '33333333-3333-4333-8333-333333333333';
const me: MeResponse = { id: 'a1', username: 'sonda_rayo', roles: [], mfa: false, level: 18 };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/** A promotion's picture: a nebula with a probe's trail, as an SVG (no file to fetch). */
const art = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><defs><radialGradient id="g" cx="62%" cy="42%" r="70%"><stop offset="0" stop-color="#ff9a3c"/><stop offset=".35" stop-color="#7259ee"/><stop offset=".7" stop-color="#181a3d"/><stop offset="1" stop-color="#05060f"/></radialGradient></defs><rect width="1600" height="900" fill="url(#g)"/>${Array.from({ length: 140 }, (_, i) => `<circle cx="${(i * 137) % 1600}" cy="${(i * 89) % 900}" r="${1 + (i % 3)}" fill="#fff" opacity="${0.25 + (i % 5) / 8}"/>`).join('')}<path d="M180 760 Q 700 520 1180 300" stroke="#ffc94a" stroke-width="10" fill="none" stroke-linecap="round" opacity=".85"/><circle cx="1180" cy="300" r="22" fill="#ffc94a"/></svg>`,
)}`;

const base = { id: ID, body: '', image: null, link: null, reward: [] } satisfies Partial<PopupView>;
const POPUPS: Record<string, PopupView> = {
  encuesta: {
    ...base,
    kind: 'survey',
    title: 'Tu opinión cuenta',
    questions: [{ type: 'scale', id: 'rec', prompt: '¿Recomendarías Galaxy Survivor a un amigo?', range: '1-5', low: 'Poco probable', high: 'Muy probable', subject: null }],
  },
  nucleo: {
    ...base,
    kind: 'survey',
    title: 'Núcleos de la temporada',
    questions: [{ type: 'scale', id: 'hard', prompt: '¿Qué te parece el siguiente Núcleo?', range: '0-10', low: 'Muy fácil', high: 'Muy difícil', subject: { kind: 'boss', id: 'anemone', name: 'La Anémona Rey', sprite: 'anemone' } }],
    reward: [
      { kind: 'currency', currency: 'coins', amount: 500 },
      { kind: 'currency', currency: 'dust', amount: 120 },
    ],
  },
  promocion: {
    ...base,
    kind: 'promotion',
    title: 'Copa de hielo',
    body:
      'El primer torneo de la temporada ya está aquí. Baja tan hondo como puedas en la Nebulosa, suma puntos con cada incursión que termines y pelea por una galaxia legendaria con acabado holo. ' +
      'Los diez mejores se llevan monedas y polvo estelar, y todos los que jueguen cinco partidas reciben su premio por participar. Inscríbete desde la pantalla de torneos antes de que se llene: ' +
      'las plazas son limitadas y la clasificación se cierra el domingo a medianoche, con los premios repartidos al día siguiente.',
    image: art,
    link: { kind: 'route', to: '/temporada', label: 'Ver el torneo' },
    questions: [],
  },
  valoracion: {
    ...base,
    kind: 'review',
    title: 'Valora Galaxy Survivor',
    body: 'Tu opinión nos ayuda a decidir qué mejorar en las próximas versiones',
    questions: [
      { type: 'stars', id: 'stars', prompt: '¿Cuántas estrellas le das?' },
      { type: 'text', id: 'why', prompt: 'Cuéntanos por qué', placeholder: 'Escribe aquí', required: false, maxLength: 500 },
    ],
  },
  formulario: {
    ...base,
    kind: 'form',
    title: 'Tu partida ideal',
    questions: [
      { type: 'choice', id: 'mode', prompt: '¿Cómo juegas más?', multi: false, options: [{ id: 'solo', label: 'Solo' }, { id: 'group', label: 'En grupo' }, { id: 'both', label: 'Las dos' }] },
      {
        type: 'choice',
        id: 'likes',
        prompt: '¿Qué es lo que más te gusta del juego?',
        multi: true,
        options: [
          { id: 'scan', label: 'El escáner y las galaxias' },
          { id: 'runs', label: 'Las incursiones' },
          { id: 'clans', label: 'Los clanes' },
          { id: 'market', label: 'El mercado' },
          { id: 'season', label: 'La temporada y su ruta' },
          { id: 'tn', label: 'Los torneos' },
          { id: 'lab', label: 'El laboratorio' },
          { id: 'probes', label: 'Las sondas y sus skins' },
        ],
      },
      { type: 'text', id: 'idea', prompt: '¿Qué añadirías?', placeholder: 'Escribe aquí', required: true, maxLength: 300 },
    ],
    reward: [{ kind: 'currency', currency: 'coins', amount: 300 }],
  },
};

let root: Root | null = null;
beforeEach(() => {
  sessionStorage.removeItem(POPUP_SESSION_KEY);
  // No entrance to wait for (the box still lands where it would after it).
  setPrefs({ motion: 'reduced' });
  document.documentElement.dataset['motion'] = 'reduced';
});
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  document.body.classList.remove('ready', 'settled');
  delete document.documentElement.dataset['motion'];
  resetPrefs();
  vi.unstubAllGlobals();
});

async function open(popup: PopupView) {
  const routes: Record<string, unknown> = { '/tutorial': { status: 'done', chapter: 'done', gift: 0 }, '/popups/next': { popup } };
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && String(url).endsWith('/answer'))
      return Promise.resolve(new Response(JSON.stringify({ granted: null, skipped: null, wallet: { coins: 18_450, dust: 2_310, signal: 7 } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    if (init?.method === 'POST') return Promise.resolve(new Response(null, { status: 204 }));
    const key = Object.keys(routes).find((k) => String(url).endsWith(k));
    // Everything else stays loading: the home behind holds its shape meanwhile.
    if (!key) return new Promise(() => {});
    return Promise.resolve(new Response(JSON.stringify(routes[key]), { status: 200, headers: { 'content-type': 'application/json' } }));
  });
  await page.viewport(1280, 720);
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
  document.body.classList.add('ready', 'settled');
  await gameFonts();
  await expect.poll(() => document.querySelector('.pop')).not.toBeNull();
  return document.querySelector<HTMLElement>('.pop')!;
}

/** At each size: nothing sideways, the box (and the round button) inside the window, the zoom of the large screens. */
async function everySize(name: string, box: HTMLElement, extra: (w: number, h: number) => void = () => {}) {
  for (const [w, h] of SIZES) {
    await page.viewport(w, h);
    await wait(120);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    for (const el of [box, ...box.querySelectorAll<HTMLElement>('.pop-more')]) {
      const r = el.getBoundingClientRect();
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.top).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(w);
      expect(r.bottom).toBeLessThanOrEqual(h);
    }
    // Nothing inside scrolls sideways either (a promotion's round button sits over its corner on purpose).
    if (!box.classList.contains('pop-promo')) expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
    expect(getComputedStyle(box).zoom).toBe(w >= 2560 ? '1.25' : '1');
    extra(w, h);
    if (shots) await page.screenshot({ path: `__shots__/popup-${name}-${w}.png` });
  }
}

const focusIn = (selector: string) => document.querySelector(selector)!.contains(document.activeElement);

test('la encuesta de 1 a 5, sin panel, como la maqueta', async () => {
  const box = await open(POPUPS['encuesta']!);
  expect(box.classList.contains('pop-bare')).toBe(true);
  expect(focusIn('.pop-scale')).toBe(true);
  await userEvent.click(document.querySelectorAll<HTMLElement>('.pop-dot')[2]!);
  await everySize('encuesta', box, () => {
    // The ends sit under the first and the last button.
    const dots = [...box.querySelectorAll('.pop-dot')].map((d) => d.getBoundingClientRect());
    const low = box.querySelector('.pop-end-low')!.getBoundingClientRect();
    const high = box.querySelector('.pop-end-high')!.getBoundingClientRect();
    expect(Math.abs((low.left + low.right) / 2 - (dots[0]!.left + dots[0]!.right) / 2)).toBeLessThan(2);
    expect(Math.abs((high.left + high.right) / 2 - (dots[4]!.left + dots[4]!.right) / 2)).toBeLessThan(2);
  });
  // Sent: the thanks in the same place, the focus on «Cerrar».
  await page.viewport(1920, 1080);
  await userEvent.click(box.querySelector<HTMLElement>('.pop-send')!);
  await expect.poll(() => box.querySelector('.pop-thanks')).not.toBeNull();
  expect(document.activeElement?.classList.contains('pop-send')).toBe(true);
  if (shots) await page.screenshot({ path: '__shots__/popup-encuesta-gracias-1920.png' });
}, 60_000);

test('la encuesta de 0 a 10 con el Núcleo dibujado y su premio', async () => {
  const box = await open(POPUPS['nucleo']!);
  expect(focusIn('.pop-scale')).toBe(true);
  await expect.poll(() => box.querySelector<HTMLImageElement>('.pop-subject-art img')?.naturalWidth ?? 0).toBeGreaterThan(0);
  await userEvent.click(document.querySelectorAll<HTMLElement>('.pop-dot')[8]!);
  await everySize('nucleo', box, (w) => {
    // The eleven buttons in one row.
    // (Their layout, not their boxes: the chosen one is a touch bigger and the one under the pointer lifts.)
    const tops = new Set([...box.querySelectorAll<HTMLElement>('.pop-dot')].map((d) => d.offsetTop));
    expect(tops.size).toBe(1);
    expect(box.querySelector('.pop-reward')).not.toBeNull();
    if (w === 1280) expect(box.querySelector('.pop-scale')!.getBoundingClientRect().width).toBeLessThan(w);
  });
}, 60_000);

test('la promoción con su imagen, el texto que se desvanece y «Ver más» en la esquina', async () => {
  const box = await open(POPUPS['promocion']!);
  await expect.poll(() => box.querySelector<HTMLImageElement>('.pop-promo-art')?.naturalWidth ?? 0, { timeout: 8000 }).toBeGreaterThan(0);
  await expect.poll(() => box.querySelector('.pop-promo-body')?.classList.contains('clamped')).toBe(true);
  expect(document.activeElement?.classList.contains('pop-x')).toBe(true);
  await everySize('promocion', box, (_w, h) => {
    const img = box.querySelector('.pop-promo-art')!.getBoundingClientRect();
    expect(img.height).toBeLessThanOrEqual(h * 0.4 + 1);
    // The round button on the panel's corner.
    const more = box.querySelector('.pop-more')!.getBoundingClientRect();
    const r = box.getBoundingClientRect();
    expect(more.right).toBeGreaterThan(r.right);
    expect(more.bottom).toBeGreaterThan(r.bottom);
  });
  await page.viewport(1920, 1080);
  await userEvent.hover(box.querySelector<HTMLElement>('.pop-more')!);
  await wait(350);
  if (shots) await page.screenshot({ path: '__shots__/popup-promocion-hover-1920.png' });
}, 60_000);

test('la valoración con sus estrellas y su texto', async () => {
  const box = await open(POPUPS['valoracion']!);
  expect(focusIn('.pop-stars')).toBe(true);
  await userEvent.click(document.querySelectorAll<HTMLElement>('.pop-star')[3]!);
  await userEvent.type(box.querySelector('textarea')!, 'Me encanta el escáner y fusionar galaxias. Echo de menos más Núcleos');
  await everySize('valoracion', box, () => {
    expect(box.querySelectorAll('.pop-star.on')).toHaveLength(4);
  });
}, 60_000);

test('el formulario en su segunda pregunta de tres, con varias opciones elegidas', async () => {
  const box = await open(POPUPS['formulario']!);
  expect(focusIn('.pop-choice')).toBe(true);
  await userEvent.click(box.querySelectorAll<HTMLElement>('.pop-option')[1]!);
  await userEvent.click(box.querySelector<HTMLElement>('.pop-next')!);
  await expect.poll(() => box.querySelectorAll('.pop-option[role="checkbox"]').length).toBe(8);
  // The focus follows to the new question.
  expect(focusIn('.pop-choice')).toBe(true);
  const options = box.querySelectorAll<HTMLElement>('.pop-option');
  await userEvent.click(options[0]!);
  await userEvent.click(options[4]!);
  await everySize('formulario', box, (w) => {
    // Two columns, four rows.
    const lefts = new Set([...options].map((o) => Math.round(o.getBoundingClientRect().left)));
    expect(lefts.size).toBe(2);
    if (w === 1280) expect(box.querySelector('.pop-steps')!.textContent).toContain('2 de 3');
  });
}, 60_000);
