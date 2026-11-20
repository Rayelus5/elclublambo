import type { ChatChannel, ChatMessage, LiveEvent } from '@galaxy/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { type ChatLive, fanout, HeadBatch } from '../../src/chat/fanout';

// Who hears a chat message on the live socket (the owner's chat asks, 2026-11-14): a clan's or a room's in full to its
// members; Comunidad's in full only to who has it open, its author and whoever it names, the rest counted in a head
// every few seconds; who blocked the author, nothing.

afterEach(() => vi.useRealTimers());
const open = (map: Record<string, ChatChannel>) => (id: string) => map[id] ?? null;
const none = new Set<string>();

describe('fanout', () => {
  test('el clan y la sala: todo a sus miembros, lo tengan abierto o no', () => {
    const r = fanout({ channel: 'clan', authorId: 'a' }, ['a', 'b', 'c'], open({ b: 'global' }), none, none);
    expect(r).toEqual({ full: ['a', 'b', 'c'], mentioned: [], counted: [] });
  });

  test('Comunidad: entero a quien la tiene abierta y al autor; el resto solo se cuenta', () => {
    const r = fanout({ channel: 'global', authorId: 'a' }, ['a', 'b', 'c', 'd'], open({ b: 'global', c: 'clan' }), none, none);
    expect(r.full).toEqual(['a', 'b']);
    expect(r.counted).toEqual(['c', 'd']);
  });

  test('a quien nombra le llega entero y marcado, aunque tenga el chat cerrado; al autor nunca como mención', () => {
    const r = fanout({ channel: 'global', authorId: 'a' }, ['a', 'b', 'c'], open({}), none, new Set(['a', 'c']));
    expect(r).toEqual({ full: ['a'], mentioned: ['c'], counted: ['b'] });
  });

  test('quien bloqueó al autor no recibe nada, ni nombrado', () => {
    const r = fanout({ channel: 'clan', authorId: 'a' }, ['a', 'b', 'c'], open({}), new Set(['b']), new Set(['b']));
    expect(r).toEqual({ full: ['a', 'c'], mentioned: [], counted: [] });
  });
});

describe('HeadBatch', () => {
  const msg = (id: string): ChatMessage => ({ id, channel: 'global', author: { username: 'vega', level: 5, clan: null }, body: 'hola', at: '2026-11-14T10:00:00.000Z' });
  function live(online: string[], opened: Record<string, ChatChannel>) {
    const sent: { to: string[]; event: LiveEvent }[] = [];
    const l: ChatLive = { onlineIds: () => new Set(online), chatOpenOf: open(opened), sendMany: (to, event) => sent.push({ to: [...to], event }) };
    return { l, sent };
  }

  test('junta lo que llega en tres segundos en un solo aviso, para quien no tiene Comunidad abierta', () => {
    vi.useFakeTimers();
    const { l, sent } = live(['a', 'b', 'c'], { b: 'global' });
    const heads = new HeadBatch(l, 3000);
    heads.add(msg('10'));
    heads.add(msg('11'));
    heads.add(msg('12'));
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(3000);
    expect(sent).toEqual([{ to: ['a', 'c'], event: { type: 'chatHead', channel: 'global', last: '12', n: 3 } }]);
    // Nothing new: nothing more.
    vi.advanceTimersByTime(6000);
    expect(sent).toHaveLength(1);
    heads.add(msg('13'));
    vi.advanceTimersByTime(3000);
    expect(sent[1]!.event).toEqual({ type: 'chatHead', channel: 'global', last: '13', n: 1 });
  });

  test('al cerrar no envía lo pendiente', () => {
    vi.useFakeTimers();
    const { l, sent } = live(['a'], {});
    const heads = new HeadBatch(l, 3000);
    heads.add(msg('1'));
    heads.close();
    vi.advanceTimersByTime(5000);
    expect(sent).toHaveLength(0);
  });
});
