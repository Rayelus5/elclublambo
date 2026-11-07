import { beforeEach, expect, test } from 'vitest';
import { clearPending, loadPending, savePending } from '../src/api/pending-run';

// A finished run whose result has not reached the server yet (plan ruling 17): kept in localStorage with its key, so
// a reload or a dropped connection never loses it and never pays it twice.

const body = { outcome: 'died' as const, ticks: 600, depth: 1, kills: 10, bossKills: 0, level: 2, loot: [{ coins: 1, dust: 0 }], hash: '0123456789abcdef', inputs: 'AQEA' };

beforeEach(() => localStorage.clear());

test('se guarda, se lee igual y se borra', () => {
  savePending({ runId: 'r1', key: 'k-12345678', body });
  expect(loadPending()).toEqual({ runId: 'r1', key: 'k-12345678', body });
  clearPending();
  expect(loadPending()).toBeNull();
});

test('algo ilegible o a medias en el almacenamiento se descarta', () => {
  localStorage.setItem('galaxy.run.pending', '{no es json');
  expect(loadPending()).toBeNull();
  localStorage.setItem('galaxy.run.pending', JSON.stringify({ runId: 'r1' }));
  expect(loadPending()).toBeNull();
  expect(localStorage.getItem('galaxy.run.pending')).toBeNull();
});
