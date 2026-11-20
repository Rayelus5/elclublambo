import type { MeResponse, ModChannel, ModMessage } from '@galaxy/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { LiveChat } from '../src/admin/ModerationScreen';
import { modLiveChat, useModLive } from '../src/api/moderation';
import { copy } from '../src/copy/es';
import { pickOption } from './pick';
import { jsonResponse, mockApi, renderAt } from './render';

// Moderation's messages (the owner's chat asks, 2026-11-14: «más sencilla y completa, que soporte 100.000 mensajes»):
// every chat at once with filters, an account's history and what can be done to it, several hidden at once, hide and
// mute in one go, delete (never undone), and what the live socket says came while one looks.

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => useModLive.setState({ open: false, fresh: {}, reports: 0 }));
});
const t = copy.admin.moderation;
const M = '/galaxy/api/admin/moderation';
const admin: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };
const channels: ModChannel[] = [
  { key: 'global', label: 'Comunidad', lastAt: '2026-11-14T09:00:00.000Z' },
  { key: 'clan:0f8f0d0e-6c1b-4c39-9a37-1f7b0c4c2a11', label: '[GX] Galácticos', lastAt: '2026-11-14T08:00:00.000Z' },
];
const message = (over: Partial<ModMessage> = {}): ModMessage => ({ id: '41', channel: 'global', author: 'vega', body: 'esto molesta', at: '2026-11-14T09:00:00.000Z', hidden: null, reports: 0, pending: 0, ...over });
const list = [message(), message({ id: '42', author: 'nova', body: 'hola a todos' }), message({ id: '43', author: 'lyra', channel: channels[1]!.key, body: 'del clan' })];
const posted = (fetch: ReturnType<typeof mockApi>, url: string) =>
  fetch.mock.calls.filter(([u, init]) => u === url && init?.method === 'POST').map(([, init]) => JSON.parse(String(init?.body ?? '{}')));
const gets = (fetch: ReturnType<typeof mockApi>) => fetch.mock.calls.filter(([u, init]) => String(u).startsWith(`${M}/messages?`) && (init?.method ?? 'GET') === 'GET').map(([u]) => String(u));

function mount(extra: Record<string, (b: unknown) => Response> = {}) {
  const fetch = mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, admin),
    [`GET ${M}/channels`]: () => jsonResponse(200, channels),
    [`GET ${M}/messages?channel=all`]: () => jsonResponse(200, list),
    ...extra,
  });
  renderAt('/admin/moderacion/chat', { '/admin/moderacion/chat': <LiveChat /> });
  return fetch;
}

test('todos los chats a la vez, cada mensaje con su chat; los filtros van al servidor', async () => {
  const fetch = mount({
    [`GET ${M}/messages?channel=all&q=molesta&state=hidden&reported=1`]: () => jsonResponse(200, [message({ hidden: { reason: 'reports', by: null, at: '2026-11-14T09:05:00.000Z' }, reports: 3 })]),
    [`GET ${M}/messages?channel=all&q=molesta`]: () => jsonResponse(200, [message()]),
    [`GET ${M}/messages?channel=all&q=molesta&state=hidden`]: () => jsonResponse(200, []),
  });
  const user = userEvent.setup();
  const clan = await screen.findByRole('article', { name: t.messageOf('lyra') });
  expect(clan).toHaveTextContent('[GX] Galácticos');
  const search = screen.getByRole('search', { name: t.search.title });
  await user.type(within(search).getByLabelText(t.search.text), 'molesta');
  await waitFor(() => expect(gets(fetch)).toContain(`${M}/messages?channel=all&q=molesta`));
  await pickOption(user, within(search).getByRole('combobox', { name: t.search.state }), t.search.states.hidden);
  await user.click(within(search).getByRole('checkbox', { name: t.search.reported }));
  const hidden = await screen.findByRole('article', { name: t.messageOf('vega') });
  await waitFor(() => expect(within(hidden).getByText(t.hiddenByReports)).toBeInTheDocument());
  await user.click(within(search).getByRole('button', { name: t.search.clear }));
  expect(await screen.findByRole('article', { name: t.messageOf('nova') })).toBeInTheDocument();
});

test('el historial de una cuenta: sus mensajes y, arriba, ocultar lo último o silenciarla', async () => {
  const fetch = mount({
    [`GET ${M}/messages?channel=all&author=vega`]: () => jsonResponse(200, [message()]),
    [`POST ${M}/authors/vega/hide`]: () => jsonResponse(200, { hidden: 4 }),
  });
  const user = userEvent.setup();
  const vega = await screen.findByRole('article', { name: t.messageOf('vega') });
  await user.click(within(vega).getByRole('button', { name: t.historyOf('vega') }));
  const head = await screen.findByRole('group', { name: t.historyTitle('vega') });
  await waitFor(() => expect(screen.queryByRole('article', { name: t.messageOf('nova') })).toBeNull());
  await user.click(within(head).getByRole('button', { name: t.hideRecent }));
  const dialog = await screen.findByRole('dialog', { name: t.hideRecentOf('vega') });
  await pickOption(user, within(dialog).getByRole('combobox', { name: t.window }), t.windows['24']!);
  await user.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Spam toda la tarde');
  await user.click(within(dialog).getByRole('button', { name: t.hideRecent }));
  await waitFor(() => expect(posted(fetch, `${M}/authors/vega/hide`)).toEqual([{ hours: 24, reason: 'Spam toda la tarde' }]));
});

test('varios a la vez: se marcan y se ocultan juntos con un motivo', async () => {
  const fetch = mount({ [`POST ${M}/messages/hide`]: () => jsonResponse(200, { hidden: 2 }) });
  const user = userEvent.setup();
  await screen.findByRole('article', { name: t.messageOf('vega') });
  await user.click(screen.getByRole('checkbox', { name: t.select('vega') }));
  await user.click(screen.getByRole('checkbox', { name: t.select('nova') }));
  const bar = screen.getByRole('group', { name: t.selected(2) });
  await user.click(within(bar).getByRole('button', { name: t.hideSelected(2) }));
  const dialog = await screen.findByRole('dialog', { name: t.hideSelected(2) });
  await user.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Insultos');
  await user.click(within(dialog).getByRole('button', { name: t.hide }));
  await waitFor(() => expect(posted(fetch, `${M}/messages/hide`)).toEqual([{ ids: ['41', '42'], reason: 'Insultos' }]));
});

test('ocultar y silenciar de una vez, y eliminar, que avisa de que no se deshace', async () => {
  const fetch = mount({
    [`POST ${M}/messages/41/hide-mute`]: () => jsonResponse(200, { hidden: true, until: '2026-11-14T10:00:00.000Z' }),
    [`POST ${M}/messages/42/delete`]: () => jsonResponse(200, { deleted: true }),
  });
  const user = userEvent.setup();
  const vega = await screen.findByRole('article', { name: t.messageOf('vega') });
  await user.click(within(vega).getByRole('button', { name: t.hideMuteOf('vega') }));
  const dialog = await screen.findByRole('dialog', { name: t.hideMuteOf('vega') });
  await pickOption(user, within(dialog).getByRole('combobox', { name: copy.admin.fields.duration }), t.durations['1440']!);
  await user.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Acoso');
  await user.click(within(dialog).getByRole('button', { name: t.hideMute }));
  await waitFor(() => expect(posted(fetch, `${M}/messages/41/hide-mute`)).toEqual([{ minutes: 1440, reason: 'Acoso' }]));
  const nova = screen.getByRole('article', { name: t.messageOf('nova') });
  await user.click(within(nova).getByRole('button', { name: t.deleteOf('nova') }));
  const del = await screen.findByRole('dialog', { name: t.deleteOf('nova') });
  expect(del).toHaveTextContent(t.deleteHint);
  await user.type(within(del).getByLabelText(copy.admin.fields.reason), 'Datos personales');
  await user.click(within(del).getByRole('button', { name: t.delete }));
  await waitFor(() => expect(posted(fetch, `${M}/messages/42/delete`)).toEqual([{ reason: 'Datos personales' }]));
});

test('un mensaje eliminado lo dice y no se puede restaurar', async () => {
  mount({ [`GET ${M}/messages?channel=all`]: () => jsonResponse(200, [message({ hidden: { reason: 'deleted', by: 'vigia', at: '2026-11-14T09:05:00.000Z' } })]) });
  const card = await screen.findByRole('article', { name: t.messageOf('vega') });
  expect(card).toHaveTextContent(t.deleted);
  expect(within(card).queryByRole('button', { name: t.restore })).toBeNull();
  expect(within(card).queryByRole('button', { name: t.deleteOf('vega') })).toBeNull();
});

test('lo que llega mientras se mira se cuenta; «Ver» lo lee', async () => {
  let reads = 0;
  mount({
    [`GET ${M}/messages?channel=all`]: () => {
      reads += 1;
      return jsonResponse(200, reads === 1 ? list : [message({ id: '44', author: 'deneb', body: 'recién llegado' }), ...list]);
    },
  });
  await screen.findByRole('article', { name: t.messageOf('vega') });
  act(() => {
    modLiveChat('global');
    modLiveChat(channels[1]!.key);
  });
  const fresh = await screen.findByRole('status');
  expect(fresh).toHaveTextContent(t.search.fresh(2));
  await userEvent.click(within(fresh).getByRole('button', { name: t.search.freshSee }));
  expect(await screen.findByRole('article', { name: t.messageOf('deneb') })).toBeInTheDocument();
  expect(screen.queryByText(t.search.fresh(2))).toBeNull();
});
