import type { RunStart } from '@galaxy/shared';
import { DEFAULT_CONTENT, offerFor, type Sim } from '@galaxy/sim';
import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ArenaScreen, type RunEnd } from '../src/arena/ArenaScreen';
import { markRadioSeen } from '../src/arena/settings';
import { copy } from '../src/copy/es';
import { useUi } from '../src/state/ui';

// The run in the browser (GDD §5.1–5.2, §15): the level-up choice, pause (also when the tab hides), abandoning with
// a confirmation, PERKINS on the radio once, an accessible HUD, and the end of the run. The PixiJS stage is replaced:
// jsdom has no WebGL, and the stage has its own browser test.

vi.mock('../src/arena/stage/stage', () => ({
  createStage: vi.fn(async () => ({
    app: {},
    render: vi.fn(),
    feed: vi.fn(),
    resize: vi.fn(),
    camera: () => ({ zoom: 2, worldW: 640, worldH: 360, bars: 0, x: 0, y: 0 }),
    destroy: vi.fn(),
  })),
}));

const run: RunStart = {
  id: '00000000-0000-4000-8000-000000000001',
  seed: '424242',
  sector: 'outer-nebula',
  probe: 'lumen',
  relics: [],
  bonuses: [],
  variant: null,
  anomaly: null,
  content: DEFAULT_CONTENT,
  contentVersion: 0,
  startedAt: '2026-11-07T10:00:00.000Z',
};

/** A loop driven by hand: `frames(n)` runs n frames of 1/60 s. */
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
let ended: RunEnd | null;
let saved: RunEnd | null;
let clock: ReturnType<typeof manualClock>;

async function mount(r: RunStart = run) {
  ended = null;
  saved = null;
  clock = manualClock();
  const view = render(<ArenaScreen run={r} onEnd={(e) => (ended = e)} onSave={(e) => (saved = e)} clock={clock} onSim={(s) => (sim = s)} />);
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}
const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

test('el diálogo de mejora aparece con la oferta, se elige con 2 y Enter, y la partida sigue', async () => {
  await mount();
  clock.frames(2);
  const p = sim.probes[0]!;
  p.pendingLevels = 1;
  p.offer = offerFor(sim, p);
  sim.status = 'choosing';
  tick(150);
  const dialog = screen.getByRole('dialog', { name: copy.arena.levelUp });
  const options = within(dialog).getAllByRole('radio');
  expect(options).toHaveLength(3);
  const wanted = p.offer[1]!;
  fireEvent.keyDown(window, { key: '2', code: 'Digit2' });
  expect(options[1]).toHaveAttribute('aria-checked', 'true');
  fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' });
  clock.frames(2);
  tick(150);
  expect(sim.status).toBe('running');
  const owned = wanted.kind === 'weapon' ? p.weapons : p.passives;
  expect(owned).toContainEqual(expect.objectContaining({ id: wanted.id, level: wanted.level }));
  expect(screen.queryByRole('dialog', { name: copy.arena.levelUp })).toBeNull();
});

test('Escape abre la pausa, Continuar la cierra, y ocultar la pestaña también pausa', async () => {
  await mount();
  clock.frames(5);
  fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
  expect(screen.getByRole('dialog', { name: copy.arena.pause })).toBeInTheDocument();
  const t = sim.tick;
  clock.frames(30);
  expect(sim.tick).toBe(t);
  fireEvent.click(screen.getByRole('button', { name: copy.arena.resume }));
  expect(screen.queryByRole('dialog', { name: copy.arena.pause })).toBeNull();
  clock.frames(5);
  expect(sim.tick).toBeGreaterThan(t);

  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(screen.getByRole('dialog', { name: copy.arena.pause })).toBeInTheDocument();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

test('al entrar en la incursión se cierra el chat, y una tecla escrita en un campo no pausa ni se queda la sonda sin espacios', async () => {
  useUi.getState().openChat('global');
  await mount();
  expect(useUi.getState().chat).toBeNull();
  clock.frames(5);
  const field = document.createElement('textarea');
  document.body.appendChild(field);
  fireEvent.keyDown(field, { key: 'p', code: 'KeyP' });
  expect(screen.queryByRole('dialog', { name: copy.arena.pause })).toBeNull();
  const space = createEvent.keyDown(field, { key: ' ', code: 'Space' });
  fireEvent(field, space);
  expect(space.defaultPrevented).toBe(false);
  field.remove();
});

test('Abandonar incursión pide confirmación y termina como abandonada, con la grabación', async () => {
  await mount();
  clock.frames(20);
  fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: copy.arena.abandon }));
  const confirm = screen.getByRole('alertdialog', { name: copy.arena.abandon });
  expect(confirm).toHaveTextContent(copy.arena.abandonBody);
  expect(ended).toBeNull();
  fireEvent.click(within(confirm).getByRole('button', { name: copy.arena.abandonConfirm }));
  expect(ended).toMatchObject({ outcome: 'abandoned', summary: { ticks: sim.tick } });
  expect(ended!.inputs).toMatch(/^[A-Za-z0-9+/]+=*$/);
});

test('PERKINS habla por radio una sola vez por mensaje y se puede cerrar', async () => {
  const first = await mount();
  expect(screen.getByRole('status', { name: 'PERKINS' })).toHaveTextContent(copy.arena.radio.start);
  fireEvent.click(screen.getByRole('button', { name: copy.arena.closeRadio }));
  expect(screen.queryByRole('status', { name: 'PERKINS' })).toBeNull();
  first.unmount();
  await mount();
  expect(screen.queryByRole('status', { name: 'PERKINS' })).toBeNull();
});

test('en un sector nuevo PERKINS lo presenta la primera vez, y no la segunda', async () => {
  markRadioSeen('start');
  const first = await mount({ ...run, sector: 'frost-rings' });
  expect(screen.getByRole('status', { name: 'PERKINS' })).toHaveTextContent(copy.arena.radio.sectors['frost-rings']!);
  first.unmount();
  await mount({ ...run, sector: 'frost-rings' });
  expect(screen.queryByRole('status', { name: 'PERKINS' })).toBeNull();
});

test('la primera vez de cada Núcleo nuevo, PERKINS dice su línea', async () => {
  markRadioSeen('start');
  markRadioSeen('sector:frost-rings');
  await mount({ ...run, sector: 'frost-rings' });
  clock.frames(2);
  // The layer is over: the next tick brings its Core.
  sim.clocks['layerStart'] = sim.tick - 300 * 60;
  clock.frames(3);
  expect(sim.boss?.def).toBe('glacier');
  expect(screen.getByRole('status', { name: 'PERKINS' })).toHaveTextContent(copy.arena.radio.bosses['glacier']!);
});

test('el HUD muestra la vida y el nivel, y anuncia las subidas sin inundar la región viva', async () => {
  await mount();
  clock.frames(2);
  tick(150);
  const hp = screen.getByRole('progressbar', { name: copy.arena.hp });
  expect(hp).toHaveAttribute('aria-valuenow', '100');
  expect(screen.getByText(copy.arena.levelShort(1))).toBeInTheDocument();
  const live = document.querySelector('[aria-live="polite"]')!;
  expect(live.textContent).toBe('');
  sim.probes[0]!.level = 2;
  tick(150);
  expect(live.textContent).toBe(copy.arena.announce.level(2));
  tick(150);
  expect(live.textContent).toBe(copy.arena.announce.level(2));
});

test('al caer la sonda, la partida termina como muerta tras un momento', async () => {
  await mount();
  clock.frames(3);
  const p = sim.probes[0]!;
  p.hp = 0;
  p.alive = false;
  sim.status = 'dead';
  clock.frames(1);
  expect(ended).toBeNull();
  tick(2000);
  expect(ended).toMatchObject({ outcome: 'died' });
});

test('al terminar, el resultado sale al momento para guardarlo, antes de cambiar de pantalla', async () => {
  await mount();
  clock.frames(3);
  const p = sim.probes[0]!;
  p.hp = 0;
  p.alive = false;
  sim.status = 'dead';
  clock.frames(1);
  expect(saved).toMatchObject({ outcome: 'died' });
  expect(ended).toBeNull();
  tick(2000);
  expect(ended).toEqual(saved);
});

test('perder el foco mientras carga la arena la deja en pausa al terminar de cargar', async () => {
  ended = null;
  clock = manualClock();
  render(<ArenaScreen run={run} onEnd={(e) => (ended = e)} clock={clock} onSim={(s) => (sim = s)} />);
  act(() => {
    window.dispatchEvent(new Event('blur'));
  });
  await act(async () => {
    await Promise.resolve();
  });
  clock.frames(30);
  expect(sim.tick).toBe(0);
  expect(screen.getByRole('dialog', { name: copy.arena.pause })).toBeInTheDocument();
});

test('con mando: la cruceta y el stick mueven la selección de mejora y A la elige', async () => {
  const pad = { axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false })) };
  Object.defineProperty(navigator, 'getGamepads', { value: () => [pad], configurable: true });
  try {
    await mount();
    clock.frames(2);
    const p = sim.probes[0]!;
    p.pendingLevels = 1;
    p.offer = offerFor(sim, p);
    sim.status = 'choosing';
    tick(150);
    const options = within(screen.getByRole('dialog', { name: copy.arena.levelUp })).getAllByRole('radio');
    pad.buttons[15]!.pressed = true;
    tick(50);
    pad.buttons[15]!.pressed = false;
    tick(50);
    expect(options[1]).toHaveAttribute('aria-checked', 'true');
    pad.axes[0] = 0.9;
    tick(50);
    pad.axes[0] = 0;
    tick(50);
    expect(options[2]).toHaveAttribute('aria-checked', 'true');
    const wanted = p.offer[2]!;
    pad.buttons[0]!.pressed = true;
    tick(50);
    pad.buttons[0]!.pressed = false;
    clock.frames(2);
    tick(150);
    expect(sim.status).toBe('running');
    const owned = wanted.kind === 'weapon' ? p.weapons : p.passives;
    expect(owned).toContainEqual(expect.objectContaining({ id: wanted.id, level: wanted.level }));
  } finally {
    delete (navigator as { getGamepads?: unknown }).getGamepads;
  }
});

test('la carta de evolución sale primera, dorada, y deja el arma evolucionada en el kit', async () => {
  await mount();
  clock.frames(2);
  const p = sim.probes[0]!;
  p.weapons = [{ id: 'pulse', level: 5, t: 0 }];
  p.passives = [{ id: 'capacitor', level: 1 }];
  p.pendingLevels = 1;
  p.offer = offerFor(sim, p);
  sim.status = 'choosing';
  tick(150);
  const dialog = screen.getByRole('dialog', { name: copy.arena.levelUp });
  const first = within(dialog).getAllByRole('radio')[0]!;
  expect(first).toHaveClass('evolve');
  expect(first).toHaveTextContent(copy.arena.evolution);
  expect(first).toHaveTextContent('Tormenta de pulsos');
  expect(first).toHaveTextContent(copy.arena.evolves('Pulso láser'));
  fireEvent.keyDown(window, { key: '1', code: 'Digit1' });
  fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' });
  clock.frames(2);
  tick(150);
  const kit = screen.getByRole('list', { name: copy.arena.weapons });
  const item = within(kit).getByText(/Tormenta de pulsos/).closest('li')!;
  expect(item).toHaveClass('evolved');
});

test('un Enter rápido en dos subidas seguidas elige de la oferta que está en pantalla, no de la siguiente', async () => {
  await mount();
  clock.frames(2);
  const p = sim.probes[0]!;
  p.pendingLevels = 2;
  p.offer = offerFor(sim, p);
  sim.status = 'choosing';
  tick(150);
  const shown = p.offer;
  fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' });
  clock.frames(2);
  const next = p.offer;
  expect(sim.status).toBe('choosing');
  expect(next).not.toBe(shown);
  // The dialog still shows the first offer: this Enter belongs to it, so it must not take from the next one.
  fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' });
  clock.frames(2);
  expect(sim.status).toBe('choosing');
  expect(p.offer).toBe(next);
  tick(150);
  fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' });
  clock.frames(2);
  expect(sim.status).toBe('running');
});
