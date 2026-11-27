import { expect, test } from 'vitest';
import { parseConfig, ROOM_MIN, roomStartBlock } from '../src';

// Rooms for group runs (2026-11-17, the owner): at most 10 rooms open at a time, waiting or playing, adjustable from the
// admin; a room that stops changing closes after 10 minutes; and nobody launches a group run alone in its room.

test('por defecto caben 10 salas abiertas a la vez y una sala parada se cierra a los 10 minutos', () => {
  const coop = parseConfig('coop', {});
  expect(coop.maxRooms).toBe(10);
  expect(coop.lobbyIdleMinutes).toBe(10);
});

const m = (over: { ready?: boolean; leader?: boolean } = {}) => ({ ready: false, leader: false, ...over });

test('una sala necesita al menos dos jugadores para despegar, y que los compañeros estén listos', () => {
  expect(ROOM_MIN).toBe(2);
  // The leader alone.
  expect(roomStartBlock([m({ leader: true })])).toBe('alone');
  // Two, the mate not ready yet.
  expect(roomStartBlock([m({ leader: true }), m()])).toBe('ready');
  // Two and ready: it may launch (the leader needs no «Listo»).
  expect(roomStartBlock([m({ leader: true }), m({ ready: true })])).toBeNull();
  // Four, one not ready.
  expect(roomStartBlock([m({ leader: true }), m({ ready: true }), m(), m({ ready: true })])).toBe('ready');
});

// An admin may launch a group run alone, to try changes (the owner, 2026-11-27); a player alone still may not.
test('un admin que lidera solo su sala puede despegar; un jugador solo, no', () => {
  expect(roomStartBlock([m({ leader: true })], { adminAlone: true })).toBeNull();
  expect(roomStartBlock([m({ leader: true })], { adminAlone: false })).toBe('alone');
  // With company, the usual rule: everyone ready.
  expect(roomStartBlock([m({ leader: true }), m()], { adminAlone: true })).toBe('ready');
  expect(roomStartBlock([m({ leader: true }), m({ ready: true })], { adminAlone: true })).toBeNull();
});
