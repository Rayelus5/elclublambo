import type { RunStart } from '@galaxy/shared';
import { DEFAULT_CONTENT, type Sim } from '@galaxy/sim';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ArenaScreen, type ArenaDebug, type RunEnd } from '../src/arena/ArenaScreen';
import { markRadioSeen } from '../src/arena/settings';
import { copy } from '../src/copy/es';
import { setPrefs } from '../src/settings/prefs';

// The admin debug mode in a solo run (2026-11-15): F2 or the pause menu opens a side panel; looking (information,
// collisions) changes nothing; the first change to play asks once and turns the run into a test run on the server
// before it applies; with the cards open the actions wait. The stage is faked: jsdom has no WebGL.

const setDebug = vi.fn();
vi.mock('../src/arena/stage/stage', () => ({
  createStage: vi.fn(async () => ({
    app: {},
    render: vi.fn(),
    feed: vi.fn(),
    resize: vi.fn(),
    camera: () => ({ zoom: 2, worldW: 640, worldH: 360, bars: 0, x: 0, y: 0 }),
    zoom: vi.fn(),
    zoomLevel: () => 0,
    setReduced: vi.fn(),
    setColorVision: vi.fn(),
    setProbeGlow: vi.fn(),
    setDebug,
    destroy: vi.fn(),
  })),
}));

const run: RunStart = {
  id: '00000000-0000-4000-8000-000000000002',
  seed: '424242',
  sector: 'outer-nebula',
  probe: 'lumen',
  relics: [],
  bonuses: [],
  variant: null,
  anomaly: null,
  skin: null,
  content: DEFAULT_CONTENT,
  contentVersion: 7,
  startedAt: '2026-11-15T10:00:00.000Z',
};

function manualClock() {
  let t = 0;
  let queued: ((now: number) => void)[] = [];
  return {
    now: () => t,
    schedule: (cb: (now: number) => void) => {
      queued.push(cb);
    },
    frames(n: number) {
      for (let i = 0; i < n; i++) {
        t += 1000 / 60;
        const q = queued;
        queued = [];
        act(() => q.forEach((cb) => cb(t)));
      }
    },
  };
}

let sim: Sim;
let clock: ReturnType<typeof manualClock>;
let ended: RunEnd | null;

async function mount(debug?: ArenaDebug) {
  clock = manualClock();
  ended = null;
  render(<ArenaScreen run={run} onEnd={(e) => (ended = e)} clock={clock} onSim={(s) => (sim = s)} debug={debug} />);
  await act(async () => {
    await Promise.resolve();
  });
  clock.frames(2);
}

const t = copy.arena.debug;
const panel = () => screen.queryByRole('complementary', { name: t.title });
const f2 = () => fireEvent.keyDown(window, { code: 'F2', key: 'F2' });
const admin = (over: Partial<ArenaDebug> = {}): ArenaDebug & { markTest: ReturnType<typeof vi.fn> } => ({ test: false, draft: false, markTest: vi.fn(async () => {}), ...over }) as never;
const confirmTest = async () => {
  const dialog = screen.getByRole('alertdialog', { name: t.confirmTitle });
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: t.confirm }));
    await Promise.resolve();
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  // No radio lines over the field: they are not what these tests look at.
  for (const id of ['start', 'sector:outer-nebula', 'levelup', 'boss', 'layer']) markRadioSeen(id);
  setDebug.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

test('sin modo depuración, F2 no abre nada y la pausa no ofrece depurar', async () => {
  await mount();
  f2();
  expect(panel()).toBeNull();
  fireEvent.keyDown(window, { code: 'Escape', key: 'Escape' });
  expect(screen.getByRole('dialog', { name: copy.arena.pause })).toBeTruthy();
  expect(screen.queryByRole('button', { name: t.open })).toBeNull();
});

test('un admin abre el panel con F2 y lo cierra con F2', async () => {
  await mount(admin());
  f2();
  expect(panel()).toBeTruthy();
  f2();
  expect(panel()).toBeNull();
});

test('desde la pausa se abre el panel y el diálogo de pausa se quita', async () => {
  await mount(admin());
  fireEvent.keyDown(window, { code: 'Escape', key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: t.open }));
  expect(panel()).toBeTruthy();
  expect(screen.queryByRole('dialog', { name: copy.arena.pause })).toBeNull();
});

test('mirar no convierte: colisiones e información no llaman al servidor', async () => {
  const d = admin();
  await mount(d);
  f2();
  fireEvent.click(screen.getByRole('button', { name: t.hitboxes }));
  expect(setDebug).toHaveBeenLastCalledWith({ hitboxes: true });
  fireEvent.click(screen.getByRole('button', { name: t.info }));
  expect(screen.getByRole('region', { name: t.infoTitle })).toBeTruthy();
  expect(d.markTest).not.toHaveBeenCalled();
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

test('la primera acción que cambia la partida pide confirmación; cancelar no aplica nada', async () => {
  const d = admin();
  await mount(d);
  f2();
  fireEvent.click(screen.getByRole('button', { name: t.speedValue(2) }));
  const dialog = screen.getByRole('alertdialog', { name: t.confirmTitle });
  expect(dialog.textContent).toContain(t.confirmBody);
  fireEvent.click(within(dialog).getByRole('button', { name: t.cancel }));
  expect(d.markTest).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: t.speedValue(1) }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByText(t.badge)).toBeNull();
});

test('al confirmar se marca en el servidor, se aplica y aparece la etiqueta de prueba', async () => {
  const d = admin();
  await mount(d);
  f2();
  fireEvent.click(screen.getByRole('button', { name: t.speedValue(2) }));
  await confirmTest();
  expect(d.markTest).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: t.speedValue(2) }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getAllByText(t.badge).length).toBeGreaterThan(0);
  // Already a test run: the next change applies at once.
  const before = sim.probes[0]!.level;
  fireEvent.click(screen.getByRole('button', { name: t.levelUp(1) }));
  expect(d.markTest).toHaveBeenCalledTimes(1);
  expect(sim.probes[0]!.level).toBe(before + 1);
});

test('si el servidor no la marca, no se aplica nada y se avisa', async () => {
  const d = admin({ markTest: vi.fn(async () => Promise.reject(new Error('forbidden'))) });
  await mount(d);
  f2();
  const before = sim.probes[0]!.level;
  fireEvent.click(screen.getByRole('button', { name: t.levelUp(1) }));
  await confirmTest();
  expect(sim.probes[0]!.level).toBe(before);
  expect(screen.getByText(t.failed)).toBeTruthy();
});

test('una incursión que ya es de prueba aplica al momento: curar llena la vida', async () => {
  const d = admin({ test: true });
  await mount(d);
  f2();
  sim.probes[0]!.hp = 1;
  fireEvent.click(screen.getByRole('button', { name: t.heal }));
  expect(d.markTest).not.toHaveBeenCalled();
  expect(sim.probes[0]!.hp).toBe(sim.probes[0]!.stats.maxHp);
});

test('acciones desactivadas eligiendo', async () => {
  await mount(admin({ test: true }));
  f2();
  fireEvent.click(screen.getByRole('button', { name: t.levelUp(1) }));
  clock.frames(2);
  act(() => vi.advanceTimersByTime(150));
  expect(sim.status).toBe('choosing');
  for (const name of [t.levelUp(1), t.heal, t.clear, t.core, t.layer]) {
    expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
  }
});

test('dar un arma desde el buscador', async () => {
  await mount(admin({ test: true }));
  f2();
  const nova = DEFAULT_CONTENT.weapons.find((w) => w.id === 'nova')!;
  fireEvent.change(screen.getByRole('searchbox', { name: t.search }), { target: { value: nova.name.toUpperCase() } });
  fireEvent.click(screen.getByRole('option', { name: new RegExp(nova.name) }));
  fireEvent.click(screen.getByRole('button', { name: t.give }));
  expect(sim.probes[0]!.weapons.some((w) => w.id === 'nova')).toBe(true);
});

test('una incursión de prueba lo dice al terminar', async () => {
  await mount(admin({ test: true }));
  fireEvent.keyDown(window, { code: 'Escape', key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: copy.arena.abandon }));
  fireEvent.click(screen.getByRole('button', { name: copy.arena.abandonConfirm }));
  expect(ended?.test).toBe(true);
});

test('un doble clic en confirmar aplica la acción una sola vez', async () => {
  const d = admin();
  await mount(d);
  f2();
  const before = sim.probes[0]!.level;
  fireEvent.click(screen.getByRole('button', { name: t.levelUp(5) }));
  const dialog = screen.getByRole('alertdialog', { name: t.confirmTitle });
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: t.confirm }));
    fireEvent.click(within(dialog).getByRole('button', { name: t.confirm }));
    await Promise.resolve();
  });
  expect(d.markTest).toHaveBeenCalledTimes(1);
  expect(sim.probes[0]!.level).toBe(before + 5);
});

test('cancelar mientras el servidor contesta no aplica la acción', async () => {
  let answer: () => void = () => {};
  const d = admin({ markTest: vi.fn(() => new Promise<void>((r) => (answer = r))) });
  await mount(d);
  f2();
  const before = sim.probes[0]!.level;
  fireEvent.click(screen.getByRole('button', { name: t.levelUp(1) }));
  const dialog = screen.getByRole('alertdialog', { name: t.confirmTitle });
  fireEvent.click(within(dialog).getByRole('button', { name: t.confirm }));
  fireEvent.click(within(dialog).getByRole('button', { name: t.cancel }));
  await act(async () => {
    answer();
    await Promise.resolve();
  });
  expect(sim.probes[0]!.level).toBe(before);
});

test('elegir una mejora de la lista no se queda el foco: Espacio sigue siendo el dash', async () => {
  await mount(admin({ test: true }));
  f2();
  const option = screen.getAllByRole('option')[0]!;
  option.focus();
  fireEvent.click(option);
  expect(document.activeElement).not.toBe(option);
});

// Centre-screen notices (2026-11-16): what happens says so in the middle of the screen; the run's settings turn them off.
test('pasar de capa lo dice en el centro de la pantalla, salvo con los avisos apagados', async () => {
  await mount(admin({ test: true }));
  f2();
  fireEvent.click(screen.getByRole('button', { name: t.layer }));
  act(() => vi.advanceTimersByTime(150));
  expect(screen.getByText(copy.arena.notices.layer(2))).toBeTruthy();
});

test('con los avisos apagados no sale nada en el centro', async () => {
  setPrefs({ runNotices: false });
  await mount(admin({ test: true }));
  f2();
  fireEvent.click(screen.getByRole('button', { name: t.layer }));
  act(() => vi.advanceTimersByTime(150));
  expect(screen.queryByText(copy.arena.notices.layer(2))).toBeNull();
  setPrefs({ runNotices: true });
});

// In-run events (2026-11-16): the panel brings any of them now, and the centre of the screen says it came.
test('el panel trae un evento al momento y lo dice en el centro', async () => {
  await mount(admin({ test: true }));
  f2();
  fireEvent.click(screen.getByRole('button', { name: copy.arena.events.wreck.name }));
  act(() => vi.advanceTimersByTime(150));
  expect(sim.world.active.map((e) => e.kind)).toEqual(['wreck']);
  expect(screen.getByText(copy.arena.notices.event.wreck)).toBeTruthy();
});

// A pending minor (2026-11-16): while the test-run question is up, losing the window's focus does not open the pause
// menu under it (with the panel closed by F2, nothing else hid it).
test('con la pregunta de prueba abierta, perder el foco no abre la pausa debajo', async () => {
  await mount(admin());
  f2();
  fireEvent.click(screen.getByRole('button', { name: t.speedValue(2) }));
  expect(screen.getByRole('alertdialog', { name: t.confirmTitle })).toBeTruthy();
  f2();
  act(() => {
    window.dispatchEvent(new Event('blur'));
  });
  expect(screen.queryByRole('dialog', { name: copy.arena.pause })).toBeNull();
  expect(screen.getByRole('alertdialog', { name: t.confirmTitle })).toBeTruthy();
});

