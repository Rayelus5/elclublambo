import { generateGalaxy, type GrantedItem, type MailMessage, type MyMailbox, parseConfig } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { copy } from '../../src/copy/es';
import { MailboxDialog } from '../../src/mail/Mailbox';
import '../../src/styles/app.css';

// The player's mailbox v2 in a real browser (mail v2, P6): messages of every kind in their colours, the filter, a
// letter with gifts of every kind and a pack, and the reveal after «Recoger todo» with two galaxies as their cards;
// at desktop and phone widths nothing grows sideways. Screenshots with VITE_MAIL_SHOTS=1.

const skin = parseConfig('cosmetics', {}).skins.find((s) => s.source === 'reward')!;
const base = { granted: null, archived: false, read: false, claimed: false, gifts: {}, expiresAt: '2026-12-08T10:00:00.000Z', body: 'Hola' };
const msg = (m: Partial<MailMessage> & Pick<MailMessage, 'id' | 'title' | 'type'>): MailMessage => ({ ...base, warn: false, at: '2026-11-16T10:00:00.000Z', contents: { v: 2, items: [], packs: [] }, ...m });
const rich = {
  v: 2 as const,
  items: [
    { kind: 'currency' as const, currency: 'coins' as const, amount: 5000 },
    { kind: 'cosmetic' as const, piece: 'skin' as const, id: skin.id },
    { kind: 'galaxy' as const, tier: 'legendary' as const, finish: 'prismatic' as const, trait: null, count: 2 },
    { kind: 'probe' as const, probe: 'bastion' },
    { kind: 'xp' as const, amount: 800 },
  ],
  packs: [{ id: 'bienvenida', name: 'Bienvenida', art: 'chest' as const, items: [{ kind: 'currency' as const, currency: 'dust' as const, amount: 300 }, { kind: 'cosmetic' as const, piece: 'frame' as const, id: 'gold' }] }],
};
const inbox: MyMailbox = {
  unread: 4,
  unclaimed: 2,
  next: null,
  names: { events: [], seasonCurrency: 'Esquirlas' },
  messages: [
    msg({ id: 'm1', title: 'Ganadores del torneo de otoño', type: 'reward', warn: true, body: 'Enhorabuena a todos los que llegaron a la final.\nAquí tenéis vuestro premio', contents: rich }),
    msg({ id: 'm2', title: 'Perdón por la caída del sábado', type: 'compensation', contents: { v: 2, items: [{ kind: 'currency', currency: 'coins', amount: 1000 }], packs: [] } }),
    msg({ id: 'm3', title: 'Lluvia de cometas este fin de semana', type: 'event' }),
    msg({ id: 'm4', title: 'Novedades de la beta', type: 'announcement', read: true }),
    msg({ id: 'm5', title: 'Gracias por tu informe', type: 'personal', read: true }),
    msg({ id: 'm6', title: 'Bienvenida de vega', type: 'referral', read: true, claimed: true }),
  ],
};
const made = [11n, 23n].map((s) => {
  const g = generateGalaxy(s * 7919n, 4);
  return { id: `g${s}`, name: g.name, tier: 4, finish: 'prismatic', seed: g.seed.toString(), designation: g.designation, traits: { ...(g.traits as unknown as Record<string, string>) } };
});
const granted: GrantedItem[] = [
  { gift: rich.items[0]!, outcome: 'granted' },
  { gift: rich.items[1]!, outcome: 'owned' },
  { gift: rich.items[2]!, outcome: 'granted', galaxies: made },
  { gift: rich.items[3]!, outcome: 'granted' },
  { gift: rich.items[4]!, outcome: 'granted' },
  { gift: { kind: 'currency', currency: 'coins', amount: 1000 }, outcome: 'granted' },
];

function respond(url: string, init?: RequestInit): Response {
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.endsWith('/mailbox/claim-all') && init?.method === 'POST') return json({ claimed: 2, wallet: { coins: 1, dust: 1, signal: 1 }, granted: [{ id: 'm1', items: granted }] });
  if (url.endsWith('/mailbox')) return json(inbox);
  if (url.includes('/mailbox?box=archive')) return json({ ...inbox, messages: [] });
  if (url.endsWith('/read')) return json({ read: true });
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

const t = copy.mail;
const shot = async (name: string, w: number) => {
  if (import.meta.env['VITE_MAIL_SHOTS']) await page.screenshot({ path: `__shots__/mailbox-${name}-${w}.png` });
};
const noSideways = (w: number) => expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
const button = (name: string | RegExp) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => (typeof name === 'string' ? (b.getAttribute('aria-label') ?? b.textContent) === name : name.test(b.textContent ?? '')))!;

for (const [w, h] of [
  [1280, 720],
  [1920, 1080],
  [390, 844],
] as const) {
  test(`buzón a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => respond(url, init)));
    const host = document.createElement('div');
    document.body.style.margin = '0';
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(MemoryRouter, null, createElement(MailboxDialog, { onClose: () => {} })),
      ),
    );
    await expect.poll(() => document.querySelectorAll('.mailbox-item').length, { timeout: 8000 }).toBe(6);
    await userEvent.click(button(/Ganadores del torneo/));
    await expect.poll(() => document.querySelectorAll('.mailbox-detail .gift-tile').length, { timeout: 5000 }).toBe(7);
    noSideways(w);
    await shot('carta', w);

    await userEvent.click(button(t.claimAll(2)));
    await expect.poll(() => document.querySelectorAll('.gift-reveal .gcard').length, { timeout: 10_000 }).toBe(2);
    await new Promise((r) => setTimeout(r, 1600));
    noSideways(w);
    await shot('revelacion', w);
  }, 60_000);
}
