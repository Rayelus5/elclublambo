import type { AdminNewsPost, MeResponse, MissionsView, NewsPost } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { AdminLayout } from '../../src/admin/AdminLayout';
import { NewsAdmin } from '../../src/admin/NewsAdmin';
import { copy } from '../../src/copy/es';
import { NewsButton } from '../../src/hub/News';
import '../../src/styles/app.css';

// The news board in a real browser (the owner, 2026-11-14: «más grande, llamativo, y profesional»): the notices, the
// featured carousel with its big image and each section's grid, with the game's own art, at 1280×720 and 1920×1080;
// nothing grows sideways and the hero's image keeps its shape. Then Admin › Tablón and its editor. Screenshots with
// VITE_NEWS_SHOTS=1.

const me: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };
const ENDS = '2026-11-16T23:00:00.000Z';
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const post = (p: Partial<AdminNewsPost> & Pick<NewsPost, 'id' | 'kind' | 'section'>): AdminNewsPost => ({ title: '', body: '', image: null, link: null, featured: false, order: 0, startsAt: null, endsAt: null, updatedAt: '2026-11-14T10:00:00.000Z', hidden: false, live: true, by: null, ...p });
const posts: AdminNewsPost[] = [
  post({ id: id(1), kind: 'auto:discord', section: 'comunidad', featured: true, image: { kind: 'gallery', key: 'discord' }, link: { kind: 'url', href: 'https://discord.gg/2TA8RvKXv3', label: 'Unirme' } }),
  post({ id: id(2), kind: 'auto:season', section: 'comunidad', order: 1, image: { kind: 'gallery', key: 'temporada' }, link: { kind: 'route', to: '/temporada', label: 'Ver la temporada' } }),
  post({ id: id(3), kind: 'custom', section: 'comunidad', order: 2, title: 'Los clanes ya compiten', body: 'Únete a uno y sumad puntos juntos en la temporada', image: { kind: 'gallery', key: 'clanes' }, link: { kind: 'route', to: '/clanes', label: 'Ver clanes' } }),
  post({ id: id(4), kind: 'auto:events', section: 'eventos', featured: true, image: { kind: 'gallery', key: 'evento' }, link: { kind: 'route', to: '/misiones', label: 'Ver el evento' } }),
  post({ id: id(5), kind: 'custom', section: 'eventos', order: 1, title: 'Torneo del sábado', body: 'Las 16 mejores puntuaciones del sector de temporada se llevan una galaxia épica', image: { kind: 'gallery', key: 'torneo' }, link: { kind: 'route', to: '/clasificacion', label: 'Ver el torneo' } }),
  post({ id: id(6), kind: 'auto:boosts', section: 'eventos', order: 2, image: { kind: 'gallery', key: 'multiplicadores' } }),
  post({ id: id(7), kind: 'auto:patch', section: 'novedades', image: { kind: 'gallery', key: 'notas' } }),
  post({ id: id(8), kind: 'custom', section: 'novedades', order: 1, title: 'Llega el mercado de trueques', body: 'Cambia galaxias y oro con otros jugadores', image: { kind: 'gallery', key: 'mercado' }, link: { kind: 'route', to: '/mercado', label: 'Ir al mercado' } }),
];
const missions: MissionsView = {
  daily: { period: 'd:2026-11-14', endsAt: ENDS, missions: [] },
  weekly: { period: 'w:2026-W46', endsAt: ENDS, missions: [] },
  season: null,
  events: [{ id: 'cosecha', name: 'Cosecha estelar', description: 'Doble de polvo en los sectores de hielo y metas de clan con premio', endsAt: ENDS, period: 'e:cosecha', goals: [], inClan: false }],
  achievements: [],
  ready: 0,
  cosmetics: { titles: [], frames: [], title: null, frame: null },
};
const DATA: Record<string, unknown> = {
  '/galaxy/api/auth/me': me,
  '/galaxy/api/notices': [{ id: 'n1', text: 'Mantenimiento el domingo de 10:00 a 10:30', tone: 'warning' }],
  '/galaxy/api/boosts': {
    boosts: [
      { id: 'b1', name: 'Fin de semana de polvo', currency: 'dust', factor: 2, endsAt: ENDS },
      { id: 'b2', name: 'Fin de semana de polvo', currency: 'coins', factor: 1.5, endsAt: ENDS },
    ],
    anomaly: { id: 'contagion', name: 'Corrosión contagiosa', description: 'Un enemigo corroído que cae corroe a los que tiene cerca' },
  },
  '/galaxy/api/news': { posts },
  '/galaxy/api/admin/news': { posts: [...posts, post({ id: id(9), kind: 'custom', section: 'novedades', order: 2, title: 'Mantenimiento', hidden: true, live: false })] },
  '/galaxy/api/admin/media': { assets: [], totalBytes: 0 },
  '/galaxy/api/notes': { notes: [{ id: 'v1-26-tablon', version: '1.26', date: '2026-11-14', title: 'Un tablón de noticias', summary: 'Las noticias pasan a ser un tablón con imágenes, secciones y un carrusel', items: [{ kind: 'nuevo', text: 'El tablón' }] }] },
  '/galaxy/api/missions': missions,
  '/galaxy/api/leaderboard?tab=general': { season: { id: 'season-1', name: 'Temporada 1', startsAt: '2026-11-09T23:00:00.000Z', endsAt: '2026-12-07T23:00:00.000Z', tiers: [350, 1400, 4200, 10000, 20000] }, tab: 'general', rows: [], me: null, total: 0 },
};

let root: Root | null = null;
afterEach(() => {
  localStorage.clear();
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function mount(path: string, element: ReturnType<typeof createElement>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => new Response(JSON.stringify(DATA[url] ?? {}), { status: 200, headers: { 'content-type': 'application/json' } })),
  );
  const host = document.createElement('div');
  document.body.style.margin = '0';
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, createElement(MemoryRouter, { initialEntries: [path] }, element)));
  return host;
}

const imagesLoaded = () => [...document.querySelectorAll<HTMLImageElement>('.news-card img, .news-admin-thumb img, .news-pick img')].every((i) => i.complete && i.naturalWidth > 0);

for (const [w, h] of [
  [1280, 720],
  [1920, 1080],
] as const) {
  test(`el tablón de noticias a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    mount('/', createElement(NewsButton));
    await expect.poll(() => document.querySelector<HTMLButtonElement>('.news-button[aria-label*="nuevas"]'), { timeout: 5000 }).toBeTruthy();
    await userEvent.click(document.querySelector<HTMLButtonElement>('.news-button')!);
    await expect.poll(() => document.querySelectorAll('.modal.news.board .news-card').length, { timeout: 5000 }).toBeGreaterThanOrEqual(6);
    await expect.poll(imagesLoaded, { timeout: 8000 }).toBe(true);
    // Let the cards' entrance end.
    await new Promise((r) => setTimeout(r, 700));
    const dialog = document.querySelector<HTMLElement>('.modal.news.board')!;
    const box = dialog.getBoundingClientRect();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(w);
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
    // The hero: its image wide on the left, the words on the right, one beside the other.
    const hero = document.querySelector<HTMLElement>('.news-hero .news-card-hero')!;
    const art = hero.querySelector<HTMLElement>('.news-card-art')!.getBoundingClientRect();
    const words = hero.querySelector<HTMLElement>('.news-card-body')!.getBoundingClientRect();
    expect(art.width).toBeGreaterThan(words.width);
    expect(Math.abs(art.top - words.top)).toBeLessThan(2);
    // The three sections side by side, like the columns of a board, their cards' words from the left.
    const columns = [...document.querySelectorAll<HTMLElement>('.modal.news.board .news-column')].map((c) => c.getBoundingClientRect());
    expect(columns).toHaveLength(3);
    expect(Math.abs(columns[0]!.top - columns[2]!.top)).toBeLessThan(2);
    expect(columns[2]!.right).toBeLessThanOrEqual(box.right);
    expect(getComputedStyle(document.querySelector<HTMLElement>('.news-column .news-card-body')!).textAlign).toBe('start');
    // Every card's words start at the same place, short or long.
    const starts = [...document.querySelectorAll<HTMLElement>('.news-column .news-card')].map((c) => c.querySelector<HTMLElement>('.news-card-body')!.getBoundingClientRect().left - c.getBoundingClientRect().left);
    expect(new Set(starts.map((x) => Math.round(x))).size).toBe(1);
    if (import.meta.env['VITE_NEWS_SHOTS']) {
      await page.screenshot({ path: `__shots__/news-board-${w}.png` });
      dialog.scrollTo({ top: dialog.scrollHeight });
      await new Promise((r) => setTimeout(r, 200));
      await page.screenshot({ path: `__shots__/news-board-${w}-end.png` });
    }
  });

  test(`Admin › Tablón y su editor a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    mount(
      '/admin/tablon',
      createElement(Routes, null, createElement(Route, { path: '/admin', element: createElement(AdminLayout) }, createElement(Route, { path: 'tablon', element: createElement(NewsAdmin) }))),
    );
    await expect.poll(() => document.querySelectorAll('.news-admin-row').length, { timeout: 5000 }).toBe(9);
    await expect.poll(imagesLoaded, { timeout: 8000 }).toBe(true);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    // Each row on one line: the thumbnail, the words and the tools.
    const row = document.querySelector<HTMLElement>('.news-admin-row')!;
    const thumb = row.querySelector<HTMLElement>('.news-admin-thumb')!.getBoundingClientRect();
    const tools = row.querySelector<HTMLElement>('.news-admin-actions')!.getBoundingClientRect();
    expect(tools.top).toBeLessThan(thumb.bottom);
    if (import.meta.env['VITE_NEWS_SHOTS']) await page.screenshot({ path: `__shots__/news-admin-${w}.png` });
    await userEvent.click(document.querySelector<HTMLButtonElement>(`button[aria-label="${copy.admin.news.editOf('Torneo del sábado')}"]`)!);
    await expect.poll(() => document.querySelector('.modal.news-editor .news-preview .news-card'), { timeout: 5000 }).toBeTruthy();
    await expect.poll(imagesLoaded, { timeout: 8000 }).toBe(true);
    // Its entrance played.
    await new Promise((r) => setTimeout(r, 600));
    const editor = document.querySelector<HTMLElement>('.modal.news-editor')!;
    const e = editor.getBoundingClientRect();
    expect(e.left).toBeGreaterThanOrEqual(0);
    expect(e.right).toBeLessThanOrEqual(w);
    expect(editor.scrollWidth).toBeLessThanOrEqual(editor.clientWidth + 1);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    if (import.meta.env['VITE_NEWS_SHOTS']) await page.screenshot({ path: `__shots__/news-editor-${w}.png` });
  });
}
