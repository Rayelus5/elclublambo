import type { AccountSettings, SettingsView } from '@galaxy/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DEFAULT_AUDIO, getSettings, setSettings } from '../src/audio/mixer';
import { manualAim, setManualAim } from '../src/arena/settings';
import { getPrefs, resetPrefs, setPrefs } from '../src/settings/prefs';
import { getSyncReady, getSyncStatus, startSync } from '../src/settings/sync';
import { getCursor, saveCursor } from '../src/ui/cursor';

// The settings on the account (plan «ajustes en la cuenta»): signed in, the account's settings replace this browser's
// (or, the first time, this browser's go up to the account); each change after that is saved a moment later, in one
// go; a failed save says so and goes again with the next change. Nothing is sent back that just came from the account.

let stop: (() => void) | null = null;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
  localStorage.clear();
  resetPrefs();
  setSettings({ ...DEFAULT_AUDIO });
  saveCursor({ on: true, size: 'medium', color: '#ffc94a' });
  setManualAim(false);
});

function fake(view: SettingsView | Promise<SettingsView>) {
  const save = vi.fn(async (s: AccountSettings): Promise<SettingsView> => ({ settings: s, updatedAt: '2026-11-12T12:00:00.000Z' }));
  const load = vi.fn(async () => view);
  return { load, save };
}
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

test('la cuenta sin ajustes recibe los de este navegador', async () => {
  setPrefs({ colorVision: 'protan', scannerPro: false });
  setSettings({ music: 0.3 });
  const deps = fake({ settings: null, updatedAt: null });
  stop = startSync(deps);
  await settle();
  await vi.advanceTimersByTimeAsync(800);
  expect(deps.save).toHaveBeenCalledTimes(1);
  expect(deps.save.mock.calls[0]![0]).toMatchObject({ v: 1, colorVision: 'protan', scannerPro: false, music: 0.3, sfx: DEFAULT_AUDIO.sfx, cursor: true, cursorSize: 'medium', manualAim: false });
  expect(getSyncStatus()).toBe('saved');
});

test('la cuenta con ajustes manda: se aplican al momento y no se vuelven a subir', async () => {
  const deps = fake({
    settings: { v: 1, colorVision: 'tritan', motion: 'reduced', music: 0.2, muted: true, cursor: false, cursorSize: 'large', cursorColor: '#6fe3ff', manualAim: true, notesSeen: '1.2' },
    updatedAt: '2026-11-12T10:00:00.000Z',
  });
  stop = startSync(deps);
  await settle();
  expect(getPrefs()).toMatchObject({ colorVision: 'tritan', motion: 'reduced', notesSeen: '1.2' });
  expect(getSettings()).toMatchObject({ music: 0.2, muted: true });
  expect(getCursor()).toEqual({ on: false, size: 'large', color: '#6fe3ff' });
  expect(manualAim()).toBe(true);
  // This browser keeps the copy, so the next start looks the same before the account answers.
  expect(JSON.parse(localStorage.getItem('galaxy.prefs')!).state.colorVision).toBe('tritan');
  await vi.advanceTimersByTimeAsync(3000);
  expect(deps.save).not.toHaveBeenCalled();
  expect(getSyncStatus()).toBe('saved');
});

test('varios cambios seguidos se guardan una sola vez, con lo último', async () => {
  const deps = fake({ settings: { v: 1 }, updatedAt: '2026-11-12T10:00:00.000Z' });
  stop = startSync(deps);
  await settle();
  setPrefs({ colorVision: 'deutan' });
  setSettings({ sfx: 0.4 });
  await vi.advanceTimersByTimeAsync(300);
  saveCursor({ size: 'small' });
  setManualAim(true);
  expect(getSyncStatus()).toBe('saving');
  await vi.advanceTimersByTimeAsync(800);
  expect(deps.save).toHaveBeenCalledTimes(1);
  expect(deps.save.mock.calls[0]![0]).toMatchObject({ colorVision: 'deutan', sfx: 0.4, cursorSize: 'small', manualAim: true });
});

test('un guardado que falla lo dice y vuelve a intentarlo con el siguiente cambio', async () => {
  const deps = fake({ settings: { v: 1 }, updatedAt: null });
  deps.save.mockRejectedValueOnce(new Error('offline'));
  stop = startSync(deps);
  await settle();
  setPrefs({ scannerPro: false });
  await vi.advanceTimersByTimeAsync(800);
  await settle();
  expect(getSyncStatus()).toBe('offline');
  setSettings({ ui: false });
  await vi.advanceTimersByTimeAsync(800);
  await settle();
  expect(deps.save).toHaveBeenCalledTimes(2);
  expect(deps.save.mock.calls[1]![0]).toMatchObject({ scannerPro: false, ui: false });
  expect(getSyncStatus()).toBe('saved');
});

test('lo que el jugador cambia antes de que llegue la cuenta gana, y se sube', async () => {
  let answer: (v: SettingsView) => void = () => {};
  const deps = fake(new Promise<SettingsView>((r) => (answer = r)));
  stop = startSync(deps);
  setPrefs({ colorVision: 'deutan' });
  answer({ settings: { v: 1, colorVision: 'protan' }, updatedAt: null });
  await settle();
  expect(getPrefs().colorVision).toBe('deutan');
  await vi.advanceTimersByTimeAsync(800);
  expect(deps.save.mock.calls[0]![0]).toMatchObject({ colorVision: 'deutan' });
});

test('un color de cursor que no es del juego no se aplica', async () => {
  const deps = fake({ settings: { v: 1, cursorColor: '#123456', cursorSize: 'small' }, updatedAt: null });
  stop = startSync(deps);
  await settle();
  expect(getCursor()).toEqual({ on: true, size: 'small', color: '#ffc94a' });
});

test('al salir, un cambio que aún esperaba se guarda en ese momento', async () => {
  const deps = fake({ settings: { v: 1 }, updatedAt: null });
  stop = startSync(deps);
  await settle();
  setPrefs({ motion: 'full' });
  stop();
  stop = null;
  expect(deps.save).toHaveBeenCalledTimes(1);
  expect(deps.save.mock.calls[0]![0]).toMatchObject({ motion: 'full' });
});

test('si la cuenta no responde, sigue con lo de este navegador y lo vuelve a pedir', async () => {
  const deps = fake({ settings: { v: 1, colorVision: 'tritan' }, updatedAt: null });
  deps.load.mockRejectedValueOnce(new Error('503'));
  stop = startSync(deps);
  await settle();
  expect(getSyncStatus()).toBe('offline');
  expect(getPrefs().colorVision).toBe('none');
  await vi.advanceTimersByTimeAsync(30_000);
  await settle();
  expect(deps.load).toHaveBeenCalledTimes(2);
  expect(getPrefs().colorVision).toBe('tritan');
});

// Review of the notes PR: the notes page marking a version seen before the account answers must not count as the
// player choosing this browser's settings; «seen» never goes back; saves never overtake each other.
test('abrir las notas antes de que llegue la cuenta no pisa sus ajustes', async () => {
  let answer: (v: SettingsView) => void = () => {};
  const deps = fake(new Promise<SettingsView>((r) => (answer = r)));
  stop = startSync(deps);
  expect(getSyncReady()).toBe(false);
  setPrefs({ notesSeen: '1.5' });
  answer({ settings: { v: 1, colorVision: 'tritan', music: 0.2, notesSeen: '1.3' }, updatedAt: null });
  await settle();
  expect(getSyncReady()).toBe(true);
  expect(getPrefs()).toMatchObject({ colorVision: 'tritan', notesSeen: '1.5' });
  expect(getSettings().music).toBe(0.2);
  await vi.advanceTimersByTimeAsync(800);
  expect(deps.save).toHaveBeenCalledTimes(1);
  expect(deps.save.mock.calls[0]![0]).toMatchObject({ colorVision: 'tritan', music: 0.2, notesSeen: '1.5' });
});

test('la última nota vista nunca vuelve atrás', async () => {
  setPrefs({ notesSeen: '1.10' });
  const deps = fake({ settings: { v: 1, notesSeen: '1.9' }, updatedAt: null });
  stop = startSync(deps);
  await settle();
  expect(getPrefs().notesSeen).toBe('1.10');
  await vi.advanceTimersByTimeAsync(800);
  expect(deps.save.mock.calls[0]![0]).toMatchObject({ notesSeen: '1.10' });
});

test('los guardados van de uno en uno, y el último cambio es el que queda', async () => {
  const deps = fake({ settings: { v: 1 }, updatedAt: null });
  const pending: (() => void)[] = [];
  deps.save.mockImplementation((s: AccountSettings) => new Promise((r) => pending.push(() => r({ settings: s, updatedAt: null }))));
  stop = startSync(deps);
  await settle();
  setPrefs({ colorVision: 'protan' });
  await vi.advanceTimersByTimeAsync(800);
  expect(deps.save).toHaveBeenCalledTimes(1);
  setPrefs({ colorVision: 'deutan' });
  await vi.advanceTimersByTimeAsync(800);
  // The first is still on its way: the second waits for it.
  expect(deps.save).toHaveBeenCalledTimes(1);
  pending.shift()!();
  await settle();
  await vi.advanceTimersByTimeAsync(0);
  expect(deps.save).toHaveBeenCalledTimes(2);
  expect(deps.save.mock.calls[1]![0]).toMatchObject({ colorVision: 'deutan' });
  expect(getSyncStatus()).toBe('saving');
  pending.shift()!();
  await settle();
  expect(getSyncStatus()).toBe('saved');
});

test('volver la conexión vuelve a pedir la cuenta una sola vez', async () => {
  const deps = fake({ settings: { v: 1, colorVision: 'tritan' }, updatedAt: null });
  deps.load.mockRejectedValueOnce(new Error('offline'));
  stop = startSync(deps);
  await settle();
  window.dispatchEvent(new Event('online'));
  await settle();
  expect(getPrefs().colorVision).toBe('tritan');
  setPrefs({ colorVision: 'deutan' });
  await vi.advanceTimersByTimeAsync(30_000);
  await settle();
  expect(deps.load).toHaveBeenCalledTimes(2);
  expect(getPrefs().colorVision).toBe('deutan');
});

test('el estilo de música viaja con los demás ajustes', async () => {
  setPrefs({ musicStyle: 'own' });
  const deps = fake({ settings: null, updatedAt: null });
  stop = startSync(deps);
  await settle();
  await vi.advanceTimersByTimeAsync(800);
  expect(deps.save.mock.calls[0]![0]).toMatchObject({ musicStyle: 'own' });
  stop();
  stop = null;
  resetPrefs();
  const other = fake({ settings: { v: 1, musicStyle: 'own' }, updatedAt: null });
  stop = startSync(other);
  await settle();
  expect(getPrefs().musicStyle).toBe('own');
});
