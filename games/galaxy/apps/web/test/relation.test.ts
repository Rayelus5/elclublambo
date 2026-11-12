import type { FriendsView } from '@galaxy/shared';
import { expect, test } from 'vitest';
import { relationOf } from '../src/social/relation';

// Who someone is to me, read from my cached friends view (Nov plan A3): no request per card in the room.
const view: FriendsView = {
  friends: [{ username: 'vega', level: 4, clan: null, presence: { status: 'offline' }, since: '2026-11-01T00:00:00Z' }],
  incoming: [{ username: 'lyra', level: 2, at: '2026-11-10T00:00:00Z' }],
  outgoing: [{ username: 'orion', level: 9, at: '2026-11-10T00:00:00Z' }],
  blocked: [{ username: 'troll', at: '2026-11-10T00:00:00Z' }],
  prefs: { invites: 'friends', showStatus: true },
  max: 200,
};

test('lee amigos, solicitudes en los dos sentidos y bloqueos', () => {
  expect(relationOf(view, 'vega')).toBe('friends');
  expect(relationOf(view, 'lyra')).toBe('incoming');
  expect(relationOf(view, 'orion')).toBe('outgoing');
  expect(relationOf(view, 'troll')).toBe('blocked');
  expect(relationOf(view, 'deneb')).toBe('none');
});

test('las mayúsculas no importan y sin vista no hay relación', () => {
  expect(relationOf(view, 'Vega')).toBe('friends');
  expect(relationOf(undefined, 'vega')).toBe('none');
});
