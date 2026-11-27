import { expect, test } from 'vitest';
import { type MemberInit, RoomManager } from '../../src/coop/rooms';

// The rooms of group runs in memory (multiplayer plan, phase 5; limits 2026-11-17, the owner): at most `maxRooms` open
// at a time, the ones waiting and the ones playing alike; a place frees when one closes; a room launches only with two
// or more players; a lobby nobody touches closes after `idleMs`.

const who = (n: number): MemberInit => ({ accountId: `a${n}`, username: `piloto${n}`, level: 5, probe: 'lumen' });

function manager(maxRooms = 2) {
  let now = 1_000_000;
  const rooms = new RoomManager({ now: () => now, maxRooms: () => maxRooms, idleMs: () => 10 * 60_000 });
  return { rooms, advance: (ms: number) => (now += ms) };
}

const errorOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return null;
};

test('el límite cuenta las salas que esperan y las que juegan, y se libera al cerrar una', () => {
  const { rooms } = manager(2);
  const playing = rooms.create(who(1), 'public', 'outer-nebula');
  rooms.launch(playing, 'run-1');
  rooms.create(who(2), 'private', 'outer-nebula');
  expect(errorOf(() => rooms.create(who(3), 'public', 'outer-nebula'))).toBe('room_limit');
  expect(rooms.counts()).toEqual({ lobby: 1, starting: 0, running: 1 });
  rooms.leave('a1');
  expect(rooms.create(who(3), 'public', 'outer-nebula').members).toHaveLength(1);
});

test('el límite se puede cambiar en caliente (la configuración en vivo)', () => {
  let max = 1;
  const rooms = new RoomManager({ maxRooms: () => max, idleMs: () => 60_000 });
  rooms.create(who(1), 'public', 'outer-nebula');
  expect(errorOf(() => rooms.create(who(2), 'public', 'outer-nebula'))).toBe('room_limit');
  max = 2;
  expect(errorOf(() => rooms.create(who(2), 'public', 'outer-nebula'))).toBeNull();
});

test('solo en la sala no se despega; con un compañero listo, sí; si el compañero se va, otra vez no', () => {
  const { rooms } = manager();
  const room = rooms.create(who(1), 'public', 'outer-nebula');
  const view = () => rooms.view(room, () => true, true);
  expect(view().canStart).toBe(false);
  rooms.join(room, who(2));
  expect(view().canStart).toBe(false);
  rooms.setReady('a2', true);
  expect(view().canStart).toBe(true);
  rooms.leave('a2');
  expect(view().canStart).toBe(false);
});

test('una sala que no cambia en el plazo se cierra en el barrido', () => {
  const { rooms, advance } = manager();
  const room = rooms.create(who(1), 'public', 'outer-nebula');
  advance(9 * 60_000);
  expect(rooms.sweep(() => true).closed).toEqual([]);
  advance(2 * 60_000);
  expect(rooms.sweep(() => true).closed).toEqual([room]);
  expect(rooms.all()).toEqual([]);
});

// An admin (with TOTP) leading a room alone may launch it, to try changes (the owner, 2026-11-27); a player may not,
// and the room's public view never says who is an admin.
test('un admin solo en su sala puede despegar; si lidera otro jugador, no', () => {
  const { rooms } = manager();
  const room = rooms.create({ ...who(1), tester: true }, 'public', 'outer-nebula');
  const view = () => rooms.view(room, () => true, true);
  expect(view().canStart).toBe(true);
  expect(JSON.stringify(view())).not.toContain('tester');
  // A mate who is not ready blocks it, as always.
  rooms.join(room, who(2));
  expect(view().canStart).toBe(false);
  // The admin leaves: the player left alone may not launch.
  rooms.leave('a1');
  expect(view().canStart).toBe(false);
});
