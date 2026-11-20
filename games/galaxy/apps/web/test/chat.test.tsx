import type { ChatHistory, ChatMessage, ClanView, LiveEvent, MeResponse } from '@galaxy/shared';
import type { QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { onChatEvent } from '../src/chat/live';
import { ChatHost } from '../src/chat/ChatPanel';
import { ClanScreen } from '../src/clans/ClanScreen';
import { copy } from '../src/copy/es';
import { TopBar } from '../src/hub/TopBar';
import { useUi } from '../src/state/ui';
import { jsonResponse, mockApi, renderAt } from './render';

// The chats on the web (GDD §14.4; M5b-2): a side sheet that does not block the game, opened from «Comunidad» or from
// one's clan; the Comunidad and Clan tabs; each message with its author, level, clan and time; writing with a counter,
// Enter to send and the reason when one cannot; what the live socket brings, without duplicates; reports and
// moderation.

const t = copy.chat;

/** The cache of the screen under test, where the live socket's events land. */
let client: QueryClient;
/** An event of the live socket, as it arrives (TanStack Query tells the screen on the next tick). */
async function live(event: LiveEvent) {
  await act(async () => {
    if (event.type === 'chat' || event.type === 'chatHead' || event.type === 'chatDeleted' || event.type === 'chatRead') onChatEvent(client, event, 'sound');
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', class {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  act(() => useUi.getState().closeChat());
});

const me = (over: Partial<MeResponse> = {}): MeResponse => ({ id: 'a1', username: 'sonda_rayo', roles: [], mfa: false, level: 6, ...over });
const msg = (id: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  channel: 'global',
  author: { username: 'vega', level: 7, clan: 'GX' },
  body: 'hola a todos',
  at: '2026-11-08T10:15:00.000Z',
  ...over,
});
const history = (over: Partial<ChatHistory> = {}): ChatHistory => ({
  channel: 'global',
  messages: [msg('10')],
  canWrite: true,
  reason: null,
  minLevel: 5,
  maxLength: 280,
  moderator: false,
  ...over,
});
const clan = { tag: 'GX', name: 'Galácticos', me: { role: 'member' } } as ClanView;
const hhmm = (iso: string) => new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

function mount(routes: Record<string, (b: unknown) => Response> = {}, mine: ClanView | null = null) {
  const fetch = mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, me()),
    'GET /galaxy/api/clans/mine': () => jsonResponse(200, mine),
    'GET /galaxy/api/chat/global': () => jsonResponse(200, history()),
    'GET /galaxy/api/chat/unread': () => jsonResponse(200, { global: 0, clan: mine ? 0 : null, room: null, mentions: { global: 0, clan: 0, room: 0 } }),
    'POST /galaxy/api/chat/read': (b) => jsonResponse(200, { id: (b as { id: string }).id }),
    ...routes,
  });
  ({ client } = renderAt('/', {
    '/': (
      <>
        <TopBar me={me()} wallet={undefined} freePull={false} onLogout={() => {}} leaving={false} />
        <ChatHost />
      </>
    ),
  }));
  return fetch;
}

async function open(user = userEvent.setup()) {
  await user.click(screen.getByRole('button', { name: copy.hub.community }));
  const panel = await screen.findByRole('dialog', { name: t.title });
  await within(panel).findByRole('log');
  return { user, panel, log: within(panel).getByRole('log') };
}
const posts = (fetch: ReturnType<typeof mockApi>, path: string) =>
  fetch.mock.calls.filter(([url, init]) => url === `/galaxy/api/chat${path}` && init?.method === 'POST').map(([, init]) => JSON.parse(String(init?.body ?? '{}')));

test('el panel es una hoja que no bloquea el juego, se abre desde Comunidad y se cierra con Escape', async () => {
  mount();
  const { user, panel } = await open();
  expect(panel).not.toHaveAttribute('aria-modal');
  expect(screen.getByRole('button', { name: copy.hub.community })).toHaveAttribute('aria-expanded', 'true');
  await waitFor(() => expect(within(panel).getByRole('combobox', { name: t.field })).toHaveFocus());

  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog', { name: t.title })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: copy.hub.community })).toHaveFocus();
});

test('la pestaña Clan solo aparece con clan, y lee el canal del clan', async () => {
  mount();
  const first = await open();
  expect(within(first.panel).getAllByRole('tab').map((x) => x.textContent)).toEqual([t.global]);
  await first.user.keyboard('{Escape}');
});

test('con clan, la pestaña Clan enseña sus mensajes', async () => {
  const fetch = mount({ 'GET /galaxy/api/chat/clan': () => jsonResponse(200, history({ channel: 'clan', messages: [msg('20', { channel: 'clan', body: 'reunión a las nueve' })] })) }, clan);
  const { user, panel } = await open();
  const clanTab = await within(panel).findByRole('tab', { name: t.clan });
  expect(within(panel).getByRole('tab', { name: t.global })).toHaveAttribute('aria-selected', 'true');
  await user.click(clanTab);
  expect(clanTab).toHaveAttribute('aria-selected', 'true');
  expect(await within(panel).findByText('reunión a las nueve')).toBeInTheDocument();
  expect(fetch.mock.calls.some(([url]) => url === '/galaxy/api/chat/clan')).toBe(true);
});

test('en una sala sale la pestaña Sala (fase 6c), que lee el chat de la sala', async () => {
  const rooms = { mine: { id: 'r1', code: 'ABC234', members: [] }, open: [], allowed: true, reason: null, minLevel: 1 };
  const fetch = mount({
    'GET /galaxy/api/rooms': () => jsonResponse(200, rooms),
    'GET /galaxy/api/chat/room': () => jsonResponse(200, history({ channel: 'room', messages: [msg('30', { channel: 'room', body: 'voy por la izquierda' })] })),
  });
  const { user, panel } = await open();
  const roomTab = await within(panel).findByRole('tab', { name: t.room });
  await user.click(roomTab);
  expect(roomTab).toHaveAttribute('aria-selected', 'true');
  expect(await within(panel).findByText('voy por la izquierda')).toBeInTheDocument();
  expect(within(panel).getByRole('combobox', { name: t.field })).toHaveAttribute('placeholder', t.placeholderRoom);
  expect(fetch.mock.calls.some(([url]) => url === '/galaxy/api/chat/room')).toBe(true);
});

test('cada mensaje enseña su autor con enlace al perfil, su nivel, su clan y la hora', async () => {
  mount();
  const { log } = await open();
  expect(within(log).getByRole('link', { name: 'vega' })).toHaveAttribute('href', '/perfil/vega');
  expect(within(log).getByText(copy.social.level(7))).toBeInTheDocument();
  expect(within(log).getByText('GX')).toBeInTheDocument();
  const time = log.querySelector('time')!;
  expect(time).toHaveAttribute('datetime', '2026-11-08T10:15:00.000Z');
  expect(time).toHaveTextContent(hhmm('2026-11-08T10:15:00.000Z'));
  expect(within(log).getByText('hola a todos')).toBeInTheDocument();
});

test('escribir: el contador, Mayúsculas con Enter salta de línea y Enter envía', async () => {
  const fetch = mount({
    'POST /galaxy/api/chat/global/messages': (b) => jsonResponse(200, msg('11', { author: { username: 'sonda_rayo', level: 6, clan: null }, body: (b as { body: string }).body })),
  });
  const { user, panel, log } = await open();
  const field = within(panel).getByRole('combobox', { name: t.field });
  await user.type(field, 'hola qué tal');
  expect(within(panel).getByText(t.count(12, 280))).toBeInTheDocument();
  await user.type(field, '{Shift>}{Enter}{/Shift}adiós');
  expect(posts(fetch, '/global/messages')).toEqual([]);
  await user.keyboard('{Enter}');
  await waitFor(() => expect(posts(fetch, '/global/messages')).toEqual([{ body: 'hola qué tal\nadiós' }]));
  expect(await within(log).findByText(/hola qué tal/)).toBeInTheDocument();
  expect(field).toHaveValue('');
});

test('sin nivel el campo está desactivado y dice el nivel que hace falta, y no hay Denunciar', async () => {
  mount({ 'GET /galaxy/api/chat/global': () => jsonResponse(200, history({ canWrite: false, reason: 'level' })) });
  const { panel, log } = await open();
  expect(within(log).queryByRole('button', { name: t.reportOf('vega') })).not.toBeInTheDocument();
  expect(within(panel).getByRole('combobox', { name: t.field })).toBeDisabled();
  expect(within(panel).getByRole('button', { name: t.send })).toBeDisabled();
  expect(within(panel).getByText(t.needLevel(5))).toBeInTheDocument();
});

test('silenciado dice hasta cuándo', async () => {
  const until = '2026-11-08T11:30:00.000Z';
  mount({ 'GET /galaxy/api/chat/global': () => jsonResponse(200, history({ canWrite: false, reason: 'muted', mutedUntil: until })) });
  const { panel } = await open();
  expect(within(panel).getByRole('combobox', { name: t.field })).toBeDisabled();
  expect(within(panel).getByText(t.mutedUntil(hhmm(until)))).toBeInTheDocument();
});

test('pasado el límite dice que vas muy deprisa y no borra lo escrito', async () => {
  mount({ 'POST /galaxy/api/chat/global/messages': () => jsonResponse(429, { error: 'rate_limited' }) });
  const { user, panel } = await open();
  const field = within(panel).getByRole('combobox', { name: t.field });
  await user.type(field, 'otra vez{Enter}');
  expect(await within(panel).findByRole('alert')).toHaveTextContent(t.tooFast);
  expect(field).toHaveValue('otra vez');
});

test('lo que llega en directo se añade una sola vez, y lo borrado desaparece', async () => {
  mount();
  const { log } = await open();
  await live({ type: 'chat', message: msg('12', { body: 'acaba de llegar' }) });
  await live({ type: 'chat', message: msg('12', { body: 'acaba de llegar' }) });
  expect(within(log).getAllByText('acaba de llegar')).toHaveLength(1);
  await live({ type: 'chat', message: msg('30', { channel: 'clan', body: 'solo del clan' }) });
  expect(within(log).queryByText('solo del clan')).not.toBeInTheDocument();
  await live({ type: 'chatDeleted', channel: 'global', id: '10' });
  expect(within(log).queryByText('hola a todos')).not.toBeInTheDocument();
});

test('al releer el canal, lo que llega mientras tanto no se pierde', async () => {
  let release: (h: ChatHistory) => void = () => {};
  let calls = 0;
  const fetch = mount({
    'GET /galaxy/api/chat/global': () => {
      calls += 1;
      if (calls === 1) return jsonResponse(200, history());
      return new Promise<Response>((r) => {
        release = (h) => r(jsonResponse(200, h));
      }) as unknown as Response;
    },
  });
  const { log } = await open();
  // The live socket came back: the channel is read again.
  await act(async () => void client.invalidateQueries({ queryKey: ['chat', 'global'] }));
  await waitFor(() => expect(fetch.mock.calls.filter(([url]) => url === '/galaxy/api/chat/global')).toHaveLength(2));
  // The read is under way when a message comes in; the answer does not have it.
  await live({ type: 'chat', message: msg('12', { body: 'en pleno camino' }) });
  await act(async () => release(history()));
  expect(await within(log).findByText('en pleno camino')).toBeInTheDocument();
  expect(within(log).getByText('hola a todos')).toBeInTheDocument();
});

test('un mensaje que llega antes del primer historial tampoco se pierde', async () => {
  let release: (h: ChatHistory) => void = () => {};
  mount({
    'GET /galaxy/api/chat/global': () =>
      new Promise<Response>((r) => {
        release = (h) => r(jsonResponse(200, h));
      }) as unknown as Response,
  });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: copy.hub.community }));
  const panel = await screen.findByRole('dialog', { name: t.title });
  await live({ type: 'chat', message: msg('12', { body: 'llegó primero' }) });
  await act(async () => release(history()));
  const log = await within(panel).findByRole('log');
  expect(await within(log).findByText('llegó primero')).toBeInTheDocument();
});

test('Denunciar pide confirmación y deja el mensaje como denunciado; lo propio no se denuncia ni un jugador modera', async () => {
  const fetch = mount({
    'GET /galaxy/api/chat/global': () => jsonResponse(200, history({ messages: [msg('9', { author: { username: 'sonda_rayo', level: 6, clan: null }, body: 'mío' }), msg('10')] })),
    'POST /galaxy/api/chat/messages/10/report': () => jsonResponse(200, { hidden: false }),
  });
  const { user, log } = await open();
  expect(within(log).queryByRole('button', { name: t.reportOf('sonda_rayo') })).not.toBeInTheDocument();
  expect(within(log).queryByRole('button', { name: t.hideOf('vega') })).not.toBeInTheDocument();
  await user.click(within(log).getByRole('button', { name: t.reportOf('vega') }));
  const confirm = await screen.findByRole('alertdialog', { name: t.reportTitle });
  await user.click(within(confirm).getByRole('button', { name: t.report }));
  await waitFor(() => expect(posts(fetch, '/messages/10/report')).toHaveLength(1));
  expect(await within(log).findByText(t.reported)).toBeInTheDocument();
  expect(within(log).queryByRole('button', { name: t.reportOf('vega') })).not.toBeInTheDocument();
  // The button it was on is gone: the focus stays in the sheet (on the list), so Escape still closes it.
  await waitFor(() => expect(log).toHaveFocus());
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog', { name: t.title })).not.toBeInTheDocument();
});

test('un moderador oculta un mensaje y silencia 1 hora con su motivo', async () => {
  const fetch = mount({
    'GET /galaxy/api/chat/global': () => jsonResponse(200, history({ moderator: true, messages: [msg('10'), msg('13', { author: { username: 'lyra', level: 5, clan: null }, body: 'spam spam' })] })),
    'POST /galaxy/api/chat/messages/10/hide': () => jsonResponse(200, { hidden: true }),
    'POST /galaxy/api/chat/mutes': () => jsonResponse(200, { until: '2026-11-08T12:00:00.000Z' }),
  });
  const { user, panel, log } = await open();
  await user.click(within(log).getByRole('button', { name: t.hideOf('vega') }));
  await waitFor(() => expect(within(log).queryByText('hola a todos')).not.toBeInTheDocument());
  expect(posts(fetch, '/messages/10/hide')).toHaveLength(1);
  await waitFor(() => expect(log).toHaveFocus());

  await user.click(within(log).getByRole('button', { name: t.muteOf('lyra') }));
  const dialog = await screen.findByRole('dialog', { name: t.muteOf('lyra') });
  await user.type(within(dialog).getByRole('textbox', { name: t.muteReason }), 'Spam');
  await user.click(within(dialog).getByRole('button', { name: t.muteConfirm }));
  await waitFor(() => expect(posts(fetch, '/mutes')).toEqual([{ username: 'lyra', minutes: 60, reason: 'Spam' }]));
  expect(await within(panel).findByText(t.mutedDone('lyra'))).toBeInTheDocument();
});

test('Chat del clan, en la página del clan, abre el panel en el canal del clan', async () => {
  mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, me()),
    'GET /galaxy/api/clans/mine': () => jsonResponse(200, { ...clan, members: [], requests: undefined }),
    'GET /galaxy/api/clans/GX': () =>
      jsonResponse(200, { tag: 'GX', name: 'Galácticos', description: '', emblem: 'comet', color: 'uv', open: true, createdAt: '2026-11-08T10:00:00.000Z', maxMembers: 30, members: [], score: 0, rank: null, me: { role: 'member' } }),
    'GET /galaxy/api/chat/clan': () => jsonResponse(200, history({ channel: 'clan', messages: [] })),
  });
  renderAt('/clanes/GX', {
    '/clanes/:tag': (
      <>
        <ClanScreen />
        <ChatHost />
      </>
    ),
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: copy.clans.chat }));
  const panel = await screen.findByRole('dialog', { name: t.title });
  expect(await within(panel).findByRole('tab', { name: t.clan })).toHaveAttribute('aria-selected', 'true');
  expect(await within(panel).findByText(t.empty)).toBeInTheDocument();
});
