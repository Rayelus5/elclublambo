import type { ChatHistory, ChatMessage, ChatUnread, ClanView, LiveEvent, MeResponse } from '@galaxy/shared';
import type { QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ChatHost } from '../src/chat/ChatPanel';
import { onChatEvent } from '../src/chat/live';
import { copy } from '../src/copy/es';
import { TopBar } from '../src/hub/TopBar';
import { useLive } from '../src/live/LiveConnection';
import { resetPrefs, setPrefs } from '../src/settings/prefs';
import { useUi } from '../src/state/ui';
import { jsonResponse, mockApi, renderAt } from './render';

// The owner's chat asks (2026-11-14): the unread count on Comunidad and on each tab («@» when someone names me), what
// arrives while the chat is closed (counted, and a notice for the chats the player chose), reading clears it, days and
// authors grouped, older messages on demand, the mention box, blocking from the chat (always asked first) and the
// full screen.

const t = copy.chat;
let client: QueryClient;
async function live(event: LiveEvent) {
  await act(async () => {
    if (event.type === 'chat' || event.type === 'chatHead' || event.type === 'chatDeleted' || event.type === 'chatRead') onChatEvent(client, event, 'sound');
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', class {});
  resetPrefs();
  useLive.setState({ toasts: [] });
});
afterEach(() => {
  vi.unstubAllGlobals();
  act(() => useUi.getState().closeChat());
});

const ME = 'sonda_rayo';
const me: MeResponse = { id: 'a1', username: ME, roles: [], mfa: false, level: 6 };
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const msg = (id: string, over: Partial<ChatMessage> = {}): ChatMessage => ({ id, channel: 'global', author: { username: 'vega', level: 7, clan: 'GX' }, body: 'hola a todos', at: minutesAgo(30), ...over });
const history = (over: Partial<ChatHistory> = {}): ChatHistory => ({ channel: 'global', messages: [msg('10')], canWrite: true, reason: null, minLevel: 5, maxLength: 280, moderator: false, ...over });
const unread = (over: Partial<ChatUnread> = {}): ChatUnread => ({ global: 0, clan: 0, room: null, mentions: { global: 0, clan: 0, room: 0 }, ...over });
const clan = { tag: 'GX', name: 'Galácticos', me: { role: 'member' } } as ClanView;

function mount(routes: Record<string, (b: unknown) => Response> = {}, u: ChatUnread = unread()) {
  const fetch = mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, me),
    'GET /galaxy/api/clans/mine': () => jsonResponse(200, clan),
    'GET /galaxy/api/chat/global': () => jsonResponse(200, history()),
    'GET /galaxy/api/chat/clan': () => jsonResponse(200, history({ channel: 'clan', messages: [msg('20', { channel: 'clan', body: 'hola clan' })] })),
    'GET /galaxy/api/chat/unread': () => jsonResponse(200, u),
    'POST /galaxy/api/chat/read': (b) => jsonResponse(200, { id: (b as { id: string }).id }),
    ...routes,
  });
  ({ client } = renderAt('/', {
    '/': (
      <>
        <TopBar me={me} wallet={undefined} freePull={false} onLogout={() => {}} leaving={false} />
        <ChatHost />
      </>
    ),
  }));
  return fetch;
}
const posts = (fetch: ReturnType<typeof mockApi>, path: string) =>
  fetch.mock.calls.filter(([url, init]) => url === `/galaxy/api${path}` && init?.method === 'POST').map(([, init]) => JSON.parse(String(init?.body ?? '{}')));

async function open(name: string | RegExp = /^Comunidad/) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name }));
  const panel = await screen.findByRole('dialog', { name: t.title });
  const log = await within(panel).findByRole('log');
  return { user, panel, log };
}

test('Comunidad dice cuánto hay sin leer, con «@» si te nombran, y abre en el canal que tiene algo nuevo', async () => {
  mount({}, unread({ global: 3, clan: 2, mentions: { global: 0, clan: 1, room: 0 } }));
  const button = await screen.findByRole('button', { name: t.communityLabel(5, 1) });
  expect(button).toHaveTextContent('@');
  await userEvent.click(button);
  const panel = await screen.findByRole('dialog', { name: t.title });
  // My clan's, which names me, opens first; Comunidad's tab keeps its count.
  expect(within(panel).getByRole('tab', { name: t.clan })).toHaveAttribute('aria-selected', 'true');
  expect(within(panel).getByRole('tab', { name: t.tabLabel(t.global, 3, 0) })).toHaveTextContent('3');
});

test('con el chat cerrado, un mensaje del clan cuenta y avisa; con sus avisos apagados solo cuenta', async () => {
  mount();
  await screen.findByRole('button', { name: /^Comunidad/ });
  await live({ type: 'chat', message: msg('21', { channel: 'clan', body: '¿alguien para una incursión?' }) });
  expect(screen.getByRole('button', { name: t.communityLabel(1, 0) })).toBeInTheDocument();
  const toast = useLive.getState().toasts.at(-1);
  expect(toast).toMatchObject({ kind: 'chat', mention: false, n: 1, message: { id: '21' } });
  // A second one joins the same notice.
  await live({ type: 'chat', message: msg('22', { channel: 'clan', body: 'yo' }) });
  expect(useLive.getState().toasts.filter((x) => x.kind === 'chat')).toHaveLength(1);
  expect(useLive.getState().toasts.at(-1)).toMatchObject({ n: 2, message: { id: '22' } });
  act(() => {
    useLive.setState({ toasts: [] });
    setPrefs({ chatNotify: { global: false, clan: false, room: true, mentions: true } });
  });
  await live({ type: 'chat', message: msg('23', { channel: 'clan' }) });
  expect(useLive.getState().toasts).toHaveLength(0);
  expect(screen.getByRole('button', { name: t.communityLabel(3, 0) })).toBeInTheDocument();
  // A mention always tells (its own switch is on), even from Comunidad.
  await live({ type: 'chat', message: msg('24', { body: `@${ME} mira esto` }), mention: true });
  expect(useLive.getState().toasts.at(-1)).toMatchObject({ kind: 'chat', mention: true });
});

test('Comunidad cerrada: el aviso de cuántos llegaron cuenta, sin notificación salvo que la actives', async () => {
  mount();
  await screen.findByRole('button', { name: /^Comunidad/ });
  await live({ type: 'chatHead', channel: 'global', last: '40', n: 4 });
  expect(screen.getByRole('button', { name: t.communityLabel(4, 0) })).toBeInTheDocument();
  expect(useLive.getState().toasts).toHaveLength(0);
  act(() => setPrefs({ chatNotify: { global: true, clan: true, room: true, mentions: true } }));
  await live({ type: 'chatHead', channel: 'global', last: '41', n: 1 });
  expect(useLive.getState().toasts.at(-1)).toMatchObject({ kind: 'chatHead', n: 1 });
});

test('leer el canal hasta abajo lo marca como leído y quita su cuenta', async () => {
  const fetch = mount({}, unread({ global: 2 }));
  await open(t.communityLabel(2, 0));
  await waitFor(() => expect(posts(fetch, '/chat/read')).toEqual([{ channel: 'global', id: '10' }]), { timeout: 2000 });
  expect(screen.getByRole('button', { name: copy.hub.community })).toBeInTheDocument();
  // While I read it, what comes does not count.
  await live({ type: 'chat', message: msg('11', { body: 'nuevo' }) });
  expect(screen.getByRole('button', { name: copy.hub.community })).toBeInTheDocument();
  expect(useLive.getState().toasts).toHaveLength(0);
});

test('los mensajes van por días y los seguidos del mismo autor se juntan', async () => {
  const day = (d: number, h: number) => {
    const x = new Date();
    x.setDate(x.getDate() - d);
    x.setHours(h, 0, 0, 0);
    return x.toISOString();
  };
  mount({
    'GET /galaxy/api/chat/global': () =>
      jsonResponse(
        200,
        history({
          messages: [
            msg('1', { at: day(1, 10), body: 'de ayer' }),
            msg('2', { at: day(0, 9), body: 'primero de hoy' }),
            msg('3', { at: new Date(Date.parse(day(0, 9)) + 60_000).toISOString(), body: 'seguido' }),
            msg('4', { at: day(0, 10), body: 'una hora después' }),
          ],
        }),
      ),
  });
  const { log } = await open();
  expect(within(log).getAllByRole('separator').map((s) => s.textContent)).toEqual([t.yesterday, t.today]);
  const item = (text: string) => within(log).getByText(text).closest('li')!;
  expect(item('seguido')).toHaveClass('cont');
  expect(within(item('seguido')).queryByRole('link', { name: 'vega' })).toBeNull();
  expect(item('una hora después')).not.toHaveClass('cont');
  expect(item('primero de hoy')).not.toHaveClass('cont');
});

test('«Ver anteriores» trae la página de antes; sin más, lo dice', async () => {
  let page = 0;
  mount({
    'GET /galaxy/api/chat/global?before=10': () => {
      page += 1;
      return jsonResponse(200, history({ messages: page === 1 ? [msg('5', { body: 'más antiguo', author: { username: 'lyra', level: 3, clan: null } })] : [] }));
    },
    'GET /galaxy/api/chat/global?before=5': () => jsonResponse(200, history({ messages: [] })),
  });
  const { user, log } = await open();
  await user.click(within(log).getByRole('button', { name: t.older }));
  expect(await within(log).findByText('más antiguo')).toBeInTheDocument();
  await user.click(within(log).getByRole('button', { name: t.older }));
  expect(await within(log).findByText(t.noOlder)).toBeInTheDocument();
});

test('escribir @ y el principio de un nombre ofrece jugadores; Enter elige y no envía', async () => {
  const fetch = mount();
  const { user, panel } = await open();
  const field = within(panel).getByRole('combobox', { name: t.field });
  await user.type(field, 'hola @ve');
  const list = await within(panel).findByRole('listbox', { name: t.mentionList });
  expect(within(list).getByRole('option', { name: 'vega' })).toHaveAttribute('aria-selected', 'true');
  expect(field).toHaveAttribute('aria-expanded', 'true');
  await user.keyboard('{Enter}');
  expect(field).toHaveValue('hola @vega ');
  expect(within(panel).queryByRole('listbox')).toBeNull();
  expect(posts(fetch, '/chat/global/messages')).toEqual([]);
});

test('un mensaje que te nombra se resalta y lo dice', async () => {
  mount({ 'GET /galaxy/api/chat/global': () => jsonResponse(200, history({ messages: [msg('10', { body: `@${ME} ven al clan` })] })) });
  const { log } = await open();
  const item = within(log).getByText(`@${ME}`).closest('li')!;
  expect(item).toHaveClass('mentions-me');
  expect(item).toHaveTextContent(t.mentionsYou);
  expect(within(item).getByText(`@${ME}`)).toHaveClass('chat-mention', 'mine');
});

test('bloquear desde el chat pregunta antes y quita sus mensajes', async () => {
  const fetch = mount({ 'POST /galaxy/api/friends/vega/block': () => jsonResponse(200, { friends: [], incoming: [], outgoing: [], blocked: [{ username: 'vega', at: '2026-11-14T10:00:00Z' }], prefs: { invites: 'friends', showStatus: true, notices: 'sound' }, max: 100 }) });
  const { user, panel, log } = await open();
  await user.click(within(log).getByRole('button', { name: t.blockOf('vega') }));
  const confirm = await screen.findByRole('alertdialog', { name: copy.friends.blockTitle('vega') });
  expect(confirm).toHaveTextContent(copy.friends.blockBodyStranger);
  expect(within(confirm).getByRole('button', { name: copy.friends.keep })).toHaveFocus();
  expect(posts(fetch, '/friends/vega/block')).toEqual([]);
  await user.click(within(confirm).getByRole('button', { name: copy.friends.block }));
  await waitFor(() => expect(within(log).queryByText('hola a todos')).toBeNull());
  expect(within(panel).getByRole('status')).toHaveTextContent(t.blockedDone('vega'));
});

test('pantalla completa: el mismo chat, en grande', async () => {
  const { user, panel } = await (async () => {
    mount();
    return open();
  })();
  const toggle = within(panel).getByRole('button', { name: t.fullscreen });
  await user.click(toggle);
  expect(panel).toHaveClass('full');
  expect(within(panel).getByRole('button', { name: t.exitFullscreen })).toHaveAttribute('aria-pressed', 'true');
});
