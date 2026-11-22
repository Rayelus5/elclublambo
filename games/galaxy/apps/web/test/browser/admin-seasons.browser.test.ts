import { type AdminSeason, CONFIG_KEYS, DEFAULT_ROUTE, DEFAULT_SHOP, type MeResponse, parseConfig } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { AdminLayout } from '../../src/admin/AdminLayout';
import { SeasonWizardScreen } from '../../src/admin/seasons/SeasonWizard';
import { copy } from '../../src/copy/es';
import '../../src/styles/app.css';

// The season wizard's editors in a real browser (plan «temporadas como fichas», PR 4, 2026-11-22): the route, the shop
// and the closing prizes of a draft, every prize as gift tiles (an old reward too), and the gift picker opened for a
// step; at four desktop widths nothing grows sideways and the picker fits the screen. Screenshots with
// VITE_SEASON_SHOTS=1 (apps/web/test/browser/__shots__/).

const t = copy.admin.seasons;
const me: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['admin'], mfa: true, level: 30 };
const DAY = 86_400_000;
const midnight = (days: number) => {
  const d = new Date(Date.now() + days * DAY);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 3_600_000).toISOString();
};
const { id: _i, name: _n, startsAt: _s, endsAt: _e, ...rules } = parseConfig('season', {});
const galaxy = (tier: string, finish = 'normal', count = 1) => ({ kind: 'galaxy', tier, finish, trait: null, count });
const route = parseConfig('seasonRoute', {
  currency: { name: 'Chispas', perPoint: 0.5, dustRate: 2 },
  steps: [
    ...DEFAULT_ROUTE.slice(0, 5),
    { at: 1600, reward: { shards: 60 }, gifts: [galaxy('epic', 'holo'), { kind: 'probe', probe: 'bastion' }] },
    { at: 2000, reward: { title: 'Leyenda de la Temporada 3' }, gifts: [{ kind: 'cosmetic', piece: 'skin', id: 'skin-lumen-aurora' }, galaxy('legendary', 'normal', 2)] },
  ],
  shop: [...DEFAULT_SHOP.slice(0, 3), { id: 'galaxia', name: 'Galaxia de temporada', price: 600, limit: 2, gifts: [galaxy('epic')] }],
  closing: {
    tierGifts: [[], [], [galaxy('rare')], [galaxy('epic')], [galaxy('legendary'), { kind: 'cosmetic', piece: 'frame', id: 'crown' }]],
    podiumGifts: [{ kind: 'probe', probe: 'bastion' }],
    places: [
      { from: 1, to: 1, gifts: [galaxy('mythic', 'prismatic')] },
      { from: 2, to: 10, gifts: [{ kind: 'currency', currency: 'coins', amount: 20_000 }, galaxy('epic', 'braille')] },
    ],
  },
});
const lab: AdminSeason['lab'] = [
  { id: 's3-hull', branch: 'probe', name: 'Casco de temporada', effect: { kind: 'stat', stat: 'maxHp' }, per: 0.02, max: 5, requires: null, cost: { dust: 400, components: 0 }, growth: 1.4, falloff: 1, at: null },
  { id: 's3-coins', branch: 'extraction', name: 'Botín de temporada', effect: { kind: 'payout', currency: 'coins' }, per: 0.03, max: 3, requires: 's3-hull', cost: { dust: 900, components: 2 }, growth: 1.5, falloff: 1, at: null },
];
const draft: AdminSeason = { id: 'season-3', name: 'Temporada 3', startsAt: midnight(8), endsAt: midnight(36), state: 'draft', open: false, version: 1, rules, route, missions: [], lab };
const keys = CONFIG_KEYS.map((key) => (key === 'content' ? { key, version: 1, createdAt: null, author: null, note: null, lazy: true } : { key, version: 1, data: parseConfig(key, {}), createdAt: null, author: null, note: null }));

function respond(url: string): Response {
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  if (url.endsWith('/auth/me')) return json(me);
  if (url.endsWith('/admin/config/keys')) return json(keys);
  if (url.endsWith('/admin/config/content')) return json({ key: 'content', version: 1, data: parseConfig('content', DEFAULT_CONTENT), createdAt: null, author: null, note: null });
  if (url.endsWith('/admin/seasons')) return json({ seasons: [draft], now: new Date().toISOString(), warnings: [] });
  if (url.endsWith('/admin/seasons/validate')) return json({ ok: true, issues: [], big: [] });
  if (url.endsWith('/content') || url.endsWith('/profile/cosmetics')) return json({ error: 'internal' }, 503);
  return json({});
}

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shot = async (name: string, w: number) => {
  if (import.meta.env['VITE_SEASON_SHOTS']) await page.screenshot({ path: `__shots__/admin-season-${name}-${w}.png` });
};
const noSideways = (w: number) => {
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
  for (const el of document.querySelectorAll<HTMLElement>('.sw-row')) expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth + 1);
};
const click = (el: Element | null | undefined) => (el as HTMLElement).click();
const byText = (selector: string, text: string) => [...document.querySelectorAll<HTMLElement>(selector)].find((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim() === text);

async function mount(w: number, h: number) {
  await page.viewport(w, h);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => respond(url)));
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
        { initialEntries: ['/admin/temporadas/season-3'] },
        createElement(Routes, null, createElement(Route, { path: '/admin', element: createElement(AdminLayout) }, createElement(Route, { path: 'temporadas/:id', element: createElement(SeasonWizardScreen) }))),
      ),
    ),
  );
  await expect.poll(() => document.querySelector('#sw-name'), { timeout: 8000 }).toBeTruthy();
  click(byText('.ev-step', `3${t.steps.content}`));
  await expect.poll(() => document.querySelectorAll('.sw-row').length, { timeout: 8000 }).toBeGreaterThan(0);
  await wait(400);
}

for (const [w, h] of [
  [1280, 720],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
] as const) {
  test(`los editores de la ruta, la tienda, el cierre y el laboratorio a ${w}×${h}`, async () => {
    await mount(w, h);
    // The route: an old reward drawn as gifts, the new ones beside it.
    expect(document.querySelectorAll('.sw-rows .gift-ico.galaxy').length).toBeGreaterThan(0);
    noSideways(w);
    await shot('ruta', w);
    click(byText('[role="radio"]', t.contentTabs.shop));
    await expect.poll(() => document.querySelector('.sw-currency')).toBeTruthy();
    await wait(300);
    noSideways(w);
    await shot('tienda', w);
    click(byText('[role="radio"]', t.contentTabs.closing));
    await expect.poll(() => document.querySelectorAll('.sw-block').length).toBe(3);
    await wait(300);
    noSideways(w);
    await shot('cierre', w);
    // The big prizes say so (this admin is not a superadmin).
    expect(document.querySelector('.cf-aside .gift-big.bad')).not.toBeNull();
    // The seasonal lab tree, with the panel's own form: a node opened.
    click(byText('[role="radio"]', t.contentTabs.lab));
    await expect.poll(() => document.querySelectorAll('.cf-card').length).toBe(2);
    click(document.querySelector('.cf-card .cf-card-title'));
    await expect.poll(() => document.querySelector('.cf-card-body')).toBeTruthy();
    await wait(300);
    noSideways(w);
    await shot('laboratorio', w);
  }, 60_000);
}

test('el selector de premios de un escalón cabe en la pantalla', async () => {
  await mount(1280, 720);
  click(byText('button', t.gifts.addTo(t.route.step(6))));
  await expect.poll(() => document.querySelector('.sw-gift-dialog')).toBeTruthy();
  await wait(400);
  const box = document.querySelector<HTMLElement>('.sw-gift-dialog')!.getBoundingClientRect();
  expect(box.right).toBeLessThanOrEqual(1280);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1280);
  await shot('selector', 1280);
  click(byText('[role="tab"]', copy.gifts.tabs.galaxies));
  await wait(400);
  await shot('selector-galaxias', 1280);
}, 60_000);
