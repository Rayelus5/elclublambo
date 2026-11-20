import { type AdminMailRow, CONFIG_KEYS, type MeResponse, parseConfig } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { AdminLayout } from '../../src/admin/AdminLayout';
import { CommunicationScreen } from '../../src/admin/communication/CommunicationScreen';
import { copy } from '../../src/copy/es';
import '../../src/styles/app.css';

// «Comunicación» in a real browser (mail v2, P3): the compose form with a message of each kind of gift — coins, a skin,
// two legendary galaxies with a sample, a probe and a pack — the letter beside it as the player will see it, the big
// gift's note, and the sent list with its kinds and gifts drawn; at four desktop widths the page never grows sideways.
// Screenshots with VITE_COMMS_SHOTS=1.

const me: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };
const mail = {
  packs: [
    { id: 'bienvenida', name: 'Bienvenida', art: 'chest', items: [{ kind: 'currency', currency: 'coins', amount: 500 }, { kind: 'currency', currency: 'dust', amount: 120 }, { kind: 'cosmetic', piece: 'frame', id: 'gold' }] },
    { id: 'veterano', name: 'Veterano', art: 'star', items: [{ kind: 'galaxy', tier: 'epic', finish: 'holo', trait: null, count: 1 }, { kind: 'xp', amount: 800 }] },
  ],
};
const keys = CONFIG_KEYS.map((key) => ({ key, version: 1, data: key === 'mail' ? parseConfig('mail', mail) : parseConfig(key, {}), createdAt: null, author: null, note: null }));
const DAY = 86_400_000;
const around = (d: number) => new Date(Date.now() + d * DAY).toISOString();
const TYPES = ['announcement', 'gift', 'compensation', 'event', 'reward', 'personal'] as const;
const sent: AdminMailRow[] = TYPES.map((type, i) => ({
  id: `m${i}`,
  title: ['Novedades de la semana', 'Un detalle del equipo', 'Perdón por la caída del sábado', 'Lluvia de cometas', 'Ganadores del torneo', 'Gracias por tu informe'][i]!,
  body: 'Hola',
  type,
  contents: {
    v: 2,
    items: i === 0 ? [] : [{ kind: 'currency', currency: 'coins', amount: 1000 * i }, ...(i > 2 ? [{ kind: 'galaxy' as const, tier: 'legendary' as const, finish: 'prismatic' as const, trait: null, count: 1 }] : [])],
    packs: i === 1 ? [{ id: 'bienvenida', name: 'Bienvenida', art: 'chest', items: mail.packs[0]!.items as never }] : [],
  },
  big: i > 2,
  gifts: {},
  audience: i % 2 ? { kind: 'all' } : { kind: 'segment', usernames: ['vega', 'orion'] },
  by: 'rayelus',
  at: around(-i),
  expiresAt: around(30 - i),
  withdrawnAt: i === 5 ? around(-1) : null,
  recipients: 1200 - i * 100,
  read: 800 - i * 50,
  claimed: 600 - i * 40,
  scheduledAt: i === 2 ? around(3) : null,
  sentAt: i === 2 ? null : around(-i),
  outcomes: { granted: 500 - i * 40, owned: i * 10, skipped: i === 4 ? 3 : 0 },
}));

function respond(url: string): Response {
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.endsWith('/auth/me')) return json(me);
  if (url.endsWith('/admin/config/keys')) return json(keys);
  if (url.endsWith('/admin/mail/preview')) return json({ recipients: 1234 });
  if (url.endsWith('/admin/mail')) return json(sent);
  if (url.endsWith('/admin/notices')) return json([]);
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

const g = copy.gifts;
const shot = async (name: string, w: number) => {
  if (import.meta.env['VITE_COMMS_SHOTS']) await page.screenshot({ path: `__shots__/admin-comms-${name}-${w}.png` });
};
const noSideways = (w: number) => expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent) === name)!;
const tab = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent === name)!;
const radio = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === name)!;

for (const [w, h] of [
  [1280, 720],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
] as const) {
  test(`comunicación a ${w}×${h}`, async () => {
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
          { initialEntries: ['/admin/comunicacion'] },
          createElement(Routes, null, createElement(Route, { path: '/admin', element: createElement(AdminLayout) }, createElement(Route, { path: 'comunicacion', element: createElement(CommunicationScreen) }))),
        ),
      ),
    );
    await expect.poll(() => document.querySelector('.gift-picker'), { timeout: 8000 }).not.toBeNull();

    // The kind, the title and the text.
    await userEvent.click(document.querySelector<HTMLInputElement>('.mail-type input[value="reward"]')!);
    const title = [...document.querySelectorAll<HTMLLabelElement>('label')].find((l) => l.textContent === copy.admin.communication.fields.title)!;
    await userEvent.type(document.getElementById(title.htmlFor)!, 'Ganadores del torneo de otoño');
    const body = [...document.querySelectorAll<HTMLLabelElement>('label')].find((l) => l.textContent === copy.admin.communication.fields.body)!;
    await userEvent.type(document.getElementById(body.htmlFor)!, 'Enhorabuena a todos los que llegaron a la final. Aquí tenéis vuestro premio');

    // Coins, a skin, two legendary galaxies, a probe and a pack.
    await userEvent.type(document.querySelector<HTMLInputElement>(`input[aria-label="${g.amountOf(g.currency.coins)}"]`)!, '5000');
    await userEvent.click(button(g.addOf(g.currency.coins)));
    await userEvent.type(document.querySelector<HTMLInputElement>(`input[aria-label="${g.amountOf(g.currency.components)}"]`)!, '120');
    await userEvent.click(button(g.addOf(g.currency.components)));
    noSideways(w);
    await shot('recursos', w);
    await userEvent.click(tab(g.tabs.style));
    await expect.poll(() => document.querySelectorAll('.gift-grid .gift-card').length, { timeout: 5000 }).toBeGreaterThan(4);
    noSideways(w);
    await shot('estilo', w);
    await userEvent.click(document.querySelectorAll<HTMLButtonElement>('.gift-grid .gift-card')[3]!);
    await userEvent.click(tab(g.tabs.galaxies));
    await userEvent.click(radio(copy.tiers.legendary));
    await userEvent.click(radio(copy.finishes.prismatic));
    const count = document.querySelector<HTMLInputElement>('.gift-builder-count input')!;
    await userEvent.clear(count);
    await userEvent.type(count, '2');
    await userEvent.click(button(g.add));
    await userEvent.click(button(g.galaxy.sample));
    await expect.poll(() => document.querySelector('.gift-builder-sample .gcard'), { timeout: 20_000 }).not.toBeNull();
    noSideways(w);
    await shot('galaxias', w);
    await userEvent.click(tab(g.tabs.probes));
    await userEvent.click(document.querySelectorAll<HTMLButtonElement>('.gift-grid .gift-card')[2]!);
    await userEvent.click(tab(g.tabs.packs));
    await userEvent.click(button(g.addOf(g.pack('Bienvenida'))));
    noSideways(w);

    // The tray holds them, the letter shows them, the big gift says why.
    expect(document.querySelectorAll('.gift-tray .gift-tile').length).toBe(5);
    expect(document.querySelectorAll('.comms-preview .gift-tile').length).toBe(8);
    expect(document.querySelector('.gift-big.ok')).not.toBeNull();
    const aside = document.querySelector<HTMLElement>('.comms-compose-aside')!.getBoundingClientRect();
    expect(aside.right).toBeLessThanOrEqual(w);
    await shot('carta', w);

    // The sent list, its kinds and gifts drawn, inside its frame.
    document.querySelector('.admin-table')!.scrollIntoView();
    expect(document.querySelectorAll('.admin-table .mail-type-chip').length).toBe(6);
    noSideways(w);
    await shot('enviados', w);
  }, 90_000);
}
