import { CONFIG_KEYS, type MeResponse, PACK_ARTS, parseConfig } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { AdminLayout } from '../../src/admin/AdminLayout';
import { PackLibraryScreen } from '../../src/admin/mail/PackLibraryScreen';
import { copy } from '../../src/copy/es';
import '../../src/styles/app.css';

// The pack library in a real browser (mail v2, P4): a pack of each art with what it gives, one off, and the editor of
// a new pack with its art chosen and its gifts; at four desktop widths the page never grows sideways. Screenshots with
// VITE_PACKS_SHOTS=1.

const me: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };
const NAMES = ['Bienvenida', 'Cofre del torneo', 'Cápsula de rescate', 'Estrella de temporada', 'Suministros', 'Regalo de aniversario'];
const mail = parseConfig('mail', {
  packs: PACK_ARTS.map((art, i) => ({
    id: `pack-${art}`,
    name: NAMES[i]!,
    art,
    enabled: i !== 4,
    items: [
      { kind: 'currency', currency: 'coins', amount: 500 * (i + 1) },
      { kind: 'currency', currency: 'dust', amount: 100 * (i + 1) },
      ...(i % 2 ? [{ kind: 'cosmetic', piece: 'frame', id: 'gold' }] : []),
      ...(i > 2 ? [{ kind: 'galaxy', tier: 'epic', finish: 'holo', trait: null, count: 1 }] : []),
      ...(i === 5 ? [{ kind: 'xp', amount: 800 }, { kind: 'probe', probe: 'bastion' }] : []),
    ],
  })),
});
const keys = CONFIG_KEYS.map((key) => ({ key, version: 7, data: key === 'mail' ? mail : parseConfig(key, {}), createdAt: null, author: null, note: null }));

function respond(url: string): Response {
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.endsWith('/auth/me')) return json(me);
  if (url.endsWith('/admin/config/keys')) return json(keys);
  if (url.endsWith('/content')) return new Response('{"error":"internal"}', { status: 503, headers: { 'content-type': 'application/json' } });
  return json({});
}

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const t = copy.admin.packs;
const g = copy.gifts;
const shot = async (name: string, w: number) => {
  if (import.meta.env['VITE_PACKS_SHOTS']) await page.screenshot({ path: `__shots__/admin-packs-${name}-${w}.png` });
};
const noSideways = (w: number) => expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent) === name)!;

for (const [w, h] of [
  [1280, 720],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
] as const) {
  test(`biblioteca de packs a ${w}×${h}`, async () => {
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
          { initialEntries: ['/admin/configuracion/mail'] },
          createElement(Routes, null, createElement(Route, { path: '/admin', element: createElement(AdminLayout) }, createElement(Route, { path: 'configuracion/mail', element: createElement(PackLibraryScreen) }))),
        ),
      ),
    );
    await expect.poll(() => document.querySelectorAll('.pack-lib-card').length, { timeout: 8000 }).toBe(6);
    expect(document.querySelectorAll('.pack-lib-card.off').length).toBe(1);
    noSideways(w);
    await shot('lista', w);

    await userEvent.click(button(t.create));
    await expect.poll(() => document.querySelector('.pack-editor'), { timeout: 5000 }).not.toBeNull();
    await userEvent.type(document.querySelector<HTMLInputElement>('.pack-editor-names input')!, 'Pack del cometa');
    await userEvent.click(document.querySelector<HTMLInputElement>('.pack-art-choice input[value="star"]')!);
    await userEvent.type(document.querySelector<HTMLInputElement>(`input[aria-label="${g.amountOf(g.currency.coins)}"]`)!, '2500');
    await userEvent.click(button(g.addOf(g.currency.coins)));
    await userEvent.type(document.querySelector<HTMLInputElement>(`input[aria-label="${g.amountOf(g.currency.signal)}"]`)!, '3');
    await userEvent.click(button(g.addOf(g.currency.signal)));
    expect(document.querySelectorAll('.pack-editor .gift-tray .gift-tile').length).toBe(2);
    expect(document.querySelectorAll('.pack-editor [role="tab"]').length).toBe(5);
    noSideways(w);
    await shot('editor', w);

    await userEvent.click(button(t.save));
    await expect.poll(() => document.querySelectorAll('.pack-lib-card').length, { timeout: 5000 }).toBe(7);
    expect(document.querySelector('.pack-lib-publish')).not.toBeNull();
    noSideways(w);
    await shot('pendiente', w);
  }, 60_000);
}
