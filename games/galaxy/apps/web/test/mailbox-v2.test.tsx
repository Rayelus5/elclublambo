import { type MailMessage, type MeResponse, type MyMailbox, parseConfig } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { TopBar } from '../src/hub/TopBar';
import { jsonResponse, mockApi, renderAt } from './render';

// The player's mailbox v2 (mail v2, P6): the inbox and the archive, a filter by kind with how many of each, «Caduca
// pronto», «Recoger todo» and its reveal of what each gift gave (what the player already had says so), archiving,
// deleting (never a gift still to collect) and more pages.
beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

const t = copy.mail;
const g = copy.gifts;
const me: MeResponse = { id: 'p1', username: 'vega', roles: [], mfa: false, level: 6 };
const skin = parseConfig('cosmetics', {}).skins.find((s) => s.source === 'reward')!;
const base = { granted: null, warn: false, archived: false, read: false, claimed: false, gifts: {}, expiresAt: '2026-12-08T10:00:00.000Z' };
const msg = (m: Partial<MailMessage> & Pick<MailMessage, 'id' | 'title' | 'type'>): MailMessage => ({
  ...base,
  body: 'Hola',
  at: '2026-11-08T10:00:00.000Z',
  contents: { v: 2, items: [], packs: [] },
  ...m,
});
const inbox: MyMailbox = {
  unread: 3,
  unclaimed: 2,
  next: 'c1',
  names: { events: [], seasonCurrency: 'Esquirlas' },
  messages: [
    msg({ id: 'm1', title: 'Premio del torneo', type: 'reward', warn: true, contents: { v: 2, items: [{ kind: 'cosmetic', piece: 'skin', id: skin.id }], packs: [] } }),
    msg({ id: 'm2', title: 'Un detalle', type: 'gift', contents: { v: 2, items: [{ kind: 'currency', currency: 'coins', amount: 200 }], packs: [] } }),
    msg({ id: 'm3', title: 'Novedades', type: 'announcement' }),
  ],
};
const more: MyMailbox = { ...inbox, next: null, messages: [msg({ id: 'm4', title: 'Un aviso viejo', type: 'announcement', read: true })] };
const archive: MyMailbox = { ...inbox, next: null, messages: [msg({ id: 'm9', title: 'Guardado', type: 'personal', read: true, archived: true })] };
const routes = (extra = {}) => ({
  'GET /galaxy/api/mailbox': () => jsonResponse(200, inbox),
  'GET /galaxy/api/mailbox?cursor=c1': () => jsonResponse(200, more),
  'GET /galaxy/api/mailbox?box=archive': () => jsonResponse(200, archive),
  'GET /galaxy/api/profile/cosmetics': () => jsonResponse(200, {}),
  'GET /galaxy/api/content': () => jsonResponse(503, { error: 'internal' }),
  'POST /galaxy/api/mailbox/m1/read': () => jsonResponse(200, { read: true }),
  'POST /galaxy/api/mailbox/m3/read': () => jsonResponse(200, { read: true }),
  ...extra,
});
const sentTo = (fetch: ReturnType<typeof mockApi>, method: string, url: string) =>
  fetch.mock.calls.filter(([u, init]) => u === url && init?.method === method).map(([, init]) => (init?.body ? JSON.parse(String(init.body)) : null));
const open = async () => {
  renderAt('/', { '/': <TopBar me={me} wallet={{ coins: 10, dust: 2, signal: 1 }} freePull={false} onLogout={() => {}} leaving={false} /> });
  await userEvent.click(await screen.findByRole('button', { name: t.unread(3) }));
  return screen.findByRole('dialog', { name: t.title });
};

test('el filtro por tipo dice cuántos hay y deja solo ese tipo; «Caduca pronto» se ve en la lista', async () => {
  mockApi(routes());
  const dialog = await open();
  const list = await within(dialog).findByRole('list', { name: t.listLabel });
  expect(within(list).getAllByRole('button')).toHaveLength(3);
  expect(within(list).getByText(t.warn)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: t.typeFilterOf(copy.mailTypes.reward.name, 1) }));
  expect(within(list).getAllByRole('button')).toHaveLength(1);
  expect(within(list).getByText('Premio del torneo')).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: t.typeFilterOf(t.allTypes, 3) }));
  expect(within(list).getAllByRole('button')).toHaveLength(3);
});

test('«Cargar más» trae la página siguiente, y el archivo tiene la suya', async () => {
  mockApi(routes());
  const dialog = await open();
  await userEvent.click(await within(dialog).findByRole('button', { name: t.loadMore }));
  expect(await within(dialog).findByText('Un aviso viejo')).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('tab', { name: t.boxes.archive }));
  expect(await within(dialog).findByText('Guardado')).toBeInTheDocument();
  expect(within(dialog).queryByText('Premio del torneo')).toBeNull();
});

test('«Recoger todo» recoge los regalos y enseña lo que dio cada uno, también lo que ya tenías', async () => {
  const fetch = mockApi(
    routes({
      'POST /galaxy/api/mailbox/claim-all': () =>
        jsonResponse(200, {
          claimed: 2,
          wallet: { coins: 210, dust: 2, signal: 1 },
          granted: [
            { id: 'm1', items: [{ gift: { kind: 'cosmetic', piece: 'skin', id: skin.id }, outcome: 'owned' }] },
            { id: 'm2', items: [{ gift: { kind: 'currency', currency: 'coins', amount: 200 }, outcome: 'granted' }] },
          ],
        }),
    }),
  );
  const dialog = await open();
  await userEvent.click(await within(dialog).findByRole('button', { name: t.claimAll(2) }));
  const reveal = await screen.findByRole('dialog', { name: t.reveal.title });
  expect(within(reveal).getByText(g.amount.coins(200))).toBeInTheDocument();
  expect(within(reveal).getByText(g.cosmetic('skin', skin.name))).toBeInTheDocument();
  expect(within(reveal).getByText(t.reveal.owned)).toBeInTheDocument();
  expect(sentTo(fetch, 'POST', '/galaxy/api/mailbox/claim-all')).toHaveLength(1);
});

test('archivar y borrar: un regalo sin recoger no se borra', async () => {
  const fetch = mockApi(
    routes({
      'PATCH /galaxy/api/mailbox/m1': () => jsonResponse(200, { archived: true }),
      'DELETE /galaxy/api/mailbox/m3': () => jsonResponse(200, { deleted: true }),
    }),
  );
  const dialog = await open();
  await userEvent.click(await within(dialog).findByRole('button', { name: /Premio del torneo/ }));
  expect(within(dialog).getByRole('button', { name: t.delete })).toBeDisabled();
  expect(within(dialog).getByText(t.deleteBlocked)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: t.archive }));
  await waitFor(() => expect(sentTo(fetch, 'PATCH', '/galaxy/api/mailbox/m1')).toEqual([{ archived: true }]));
  await userEvent.click(within(dialog).getByRole('button', { name: /Novedades/ }));
  await userEvent.click(within(dialog).getByRole('button', { name: t.delete }));
  await waitFor(() => expect(sentTo(fetch, 'DELETE', '/galaxy/api/mailbox/m3')).toHaveLength(1));
});
