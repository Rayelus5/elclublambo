import type { LiveEvent, LiveNotice } from '@galaxy/shared';
import { EventEmitter } from 'node:events';
import { expect, test } from 'vitest';
import type { WebSocket } from 'ws';
import { LiveHub } from '../../src/realtime/live-hub';
import { Notices, withNotices } from '../../src/realtime/notices';

// Real-time notices (plan of 2026-11-12): collected while a change runs and sent only once it resolved, once; the hub
// sends one event to many accounts serialized once, and only to their open sockets.

const mail: LiveNotice = { kind: 'mail', id: 'm1', title: 'Hola' };

function sink() {
  const sent: { to: string; event: LiveEvent }[] = [];
  return { sent, send: (to: string, event: LiveEvent) => sent.push({ to, event }) };
}

test('los avisos salen al terminar el cambio, una sola vez, y sin destino no pasa nada', async () => {
  const live = sink();
  const out = new Notices();
  out.add('a1', mail);
  expect(live.sent).toEqual([]);
  out.flush(live);
  out.flush(live);
  expect(live.sent).toEqual([{ to: 'a1', event: { type: 'notice', notice: mail } }]);
  const quiet = new Notices();
  quiet.add('a1', mail);
  expect(() => quiet.flush(undefined)).not.toThrow();
});

test('si el cambio falla no sale ningún aviso', async () => {
  const live = sink();
  await expect(
    withNotices(live, async (out) => {
      out.add('a1', mail);
      throw new Error('rollback');
    }),
  ).rejects.toThrow('rollback');
  expect(live.sent).toEqual([]);
  expect(await withNotices(live, async (out) => (out.add('a2', mail), 7))).toBe(7);
  expect(live.sent.map((s) => s.to)).toEqual(['a2']);
});

class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  terminate() {
    this.readyState = 3;
  }
}

test('sendMany llega a las cuentas indicadas y a nadie más', () => {
  const hub = new LiveHub({ friendsOf: async () => [], showsStatus: async () => true });
  const [a, b, c] = [new FakeSocket(), new FakeSocket(), new FakeSocket()];
  hub.add(a as unknown as WebSocket, { accountId: 'a', username: 'a', sessionId: 's1' }, () => {});
  hub.add(b as unknown as WebSocket, { accountId: 'b', username: 'b', sessionId: 's2' }, () => {});
  hub.add(c as unknown as WebSocket, { accountId: 'c', username: 'c', sessionId: 's3' }, () => {});
  hub.sendMany(['a', 'c', 'nadie'], { type: 'notice', notice: mail });
  expect(a.sent).toEqual([JSON.stringify({ type: 'notice', notice: mail })]);
  expect(b.sent).toEqual([]);
  expect(c.sent).toHaveLength(1);
  void hub.close();
});
