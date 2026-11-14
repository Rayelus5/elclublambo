import type { RunStart } from '@galaxy/shared';
import { botInput, botPick, DEFAULT_CONTENT, offerFor, type Sim, step } from '@galaxy/sim';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { ArenaScreen } from '../../src/arena/ArenaScreen';
import { copy } from '../../src/copy/es';
import '../../src/styles/app.css';

// The whole run screen in a real browser: the PixiJS arena with the React HUD on top. With VITE_ARENA_SHOTS=1 it
// saves screenshots of the HUD at 1280×720 and 3440×1440 and of the level-up choice for review.

const run: RunStart = {
  id: '00000000-0000-4000-8000-000000000002',
  seed: '20261107',
  sector: 'outer-nebula',
  probe: 'lumen',
  relics: [],
  bonuses: [],
  variant: null,
  anomaly: null,
  skin: null,
  content: DEFAULT_CONTENT,
  contentVersion: 0,
  startedAt: '2026-11-07T10:00:00.000Z',
};

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

/** A busy CI browser may lose the window's focus, which pauses the run (by design): back to it. */
const unpause = () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === copy.arena.resume)?.click();

/** Plays `ticks` with the bot before the screen starts its own loop. */
function advance(sim: Sim, ticks: number): void {
  while (sim.tick < ticks && (sim.status === 'running' || sim.status === 'choosing')) {
    const p = sim.probes[0]!;
    if (sim.status === 'choosing') step(sim, [{ mx: 0, my: 0, aim: -1, pick: botPick(p.offer!) }]);
    else step(sim, [botInput(sim, 0, 99)]);
  }
}

async function show(width: number, height: number, ticks: number, then?: (sim: Sim) => void): Promise<Sim> {
  await page.viewport(width, height);
  document.body.style.margin = '0';
  const host = document.createElement('div');
  document.body.appendChild(host);
  let sim: Sim | null = null;
  root = createRoot(host);
  root.render(
    createElement(ArenaScreen, {
      run,
      onEnd: () => {},
      onSim: (s: Sim) => {
        if (sim) return;
        sim = s;
        advance(s, ticks);
        then?.(s);
      },
    }),
  );
  await new Promise((r) => setTimeout(r, 1200));
  return sim!;
}

test('el HUD sobre la arena: vida, nivel, tiempo, capa, botín y equipo', async () => {
  const sim = await show(1280, 720, 4 * 3600);
  // The fast-forward blocks the page for a while under load: wait for the HUD's next read, not a fixed time.
  await vi.waitFor(
    () => {
      unpause();
      expect(document.querySelectorAll('.hud-kit-item').length).toBeGreaterThan(1);
    },
    { timeout: 30_000 },
  );
  expect(document.querySelector('.hud-hp')).not.toBeNull();
  expect(sim.tick).toBeGreaterThan(4 * 3600 - 10);
  if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: '__shots__/hud-1280.png' });
}, 120_000);

test('en una ultrapanorámica el HUD se ancla a los bordes y la arena lleva bandas', async () => {
  await show(3440, 1440, 5 * 3600 + 120);
  await vi.waitFor(
    () => {
      unpause();
      expect(document.querySelector('.hud-boss')).not.toBeNull();
    },
    { timeout: 30_000 },
  );
  if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: '__shots__/hud-3440.png' });
}, 120_000);

test('la elección de mejora con sus tres cartas', async () => {
  await show(1280, 720, 60 * 60, (s) => {
    const p = s.probes[0]!;
    p.pendingLevels = 1;
    p.offer = offerFor(s, p);
    s.status = 'choosing';
  });
  await vi.waitFor(() => expect(document.querySelectorAll('.levelup-card')).toHaveLength(3), { timeout: 30_000 });
  if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: '__shots__/levelup-1280.png' });
}, 120_000);

test('la carta de evolución, dorada y primera, y el arma evolucionada en el kit', async () => {
  await show(1280, 720, 60 * 60, (s) => {
    const p = s.probes[0]!;
    p.weapons = [{ id: 'pulse', level: 5, t: 0 }, { id: 'orbit', level: 5, t: 0 }];
    p.passives = [{ id: 'capacitor', level: 1 }, { id: 'armor', level: 2 }];
    p.pendingLevels = 1;
    p.offer = offerFor(s, p);
    s.status = 'choosing';
  });
  await vi.waitFor(() => expect(document.querySelector('.levelup-card.evolve')).not.toBeNull(), { timeout: 30_000 });
  if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: '__shots__/evolve-1280.png' });
}, 120_000);

// The dash (SIM 1.12.0): SHIFT or the left click (the owner's defaults, 2026-11-14) ask for one, and its meter by the life bar says the charges ready, the next one
// filling and the short pause between two. Spark has two charges.
for (const [w, h] of [
  [1280, 720],
  [1920, 1080],
] as const) {
  test(`el dash con SHIFT y con el clic, y su medidor junto a la vida a ${w}×${h}`, async () => {
    const sim = await show(w, h, 600);
    // A Spark for its two charges (the screen's run is Lumen: same sim, its quirk swapped before the first dash).
    const p = sim.probes[0]!;
    p.def = { ...p.def, quirk: { kind: 'dash', invuln: 0.3, charges: 1, recharge: 4, pause: 0.3 } };
    p.dash.charges = 2;
    // No level-up card in the way (a dash never happens while the cards are up), and no fall.
    p.xpNext = 1e12;
    p.hp = p.stats.maxHp = 1e9;
    await vi.waitFor(() => expect(sim.status).toBe('running'), { timeout: 30_000 });
    await vi.waitFor(() => expect(document.querySelectorAll('.hud-dash-charges i.on')).toHaveLength(2), { timeout: 30_000 });
    expect(document.querySelector('.hud-dash')!.classList.contains('ready')).toBe(true);
    expect(document.querySelector('.hud-dash kbd')!.textContent).toBe('SHIFT');
    if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: `__shots__/hud-dash-ready-${w}.png` });
    // Back to the run before pressing (a CI browser may have lost the focus).
    unpause();
    await vi.waitFor(() => expect(document.querySelector('.pause-menu, [aria-label="' + copy.arena.pause + '"]')).toBeNull(), { timeout: 5_000 }).catch(() => {});
    const x0 = p.x;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft', key: 'Shift' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft', key: 'Shift' }));
    await vi.waitFor(
      () => {
        // Paused in between: resume and ask again.
        if (p.dash.charges === 2 && document.querySelector('[role="dialog"]')) {
          unpause();
          window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft', key: 'Shift' }));
        }
        expect(p.dash.charges).toBe(1);
      },
      { timeout: 15_000 },
    );
    await vi.waitFor(() => expect(Math.hypot(p.x - x0, p.y)).toBeGreaterThan(40), { timeout: 10_000 });
    await vi.waitFor(() => expect(document.querySelectorAll('.hud-dash-charges i.on')).toHaveLength(1), { timeout: 10_000 });
    expect(document.querySelector('.hud-dash-charges i.next')).not.toBeNull();
    // The left click on the field is the dash's other key (the owner, 2026-11-14). Pressed during the pause between two
    // dashes, it waits for it instead of being lost.
    document.querySelector('canvas.arena-canvas')!.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
    await vi.waitFor(() => expect(p.dash.charges).toBe(0), { timeout: 10_000 });
    await vi.waitFor(() => expect(document.querySelectorAll('.hud-dash-charges i.on')).toHaveLength(0), { timeout: 10_000 });
    expect(document.querySelector('.hud-dash')!.getAttribute('aria-label')).toMatch(/^Dash con SHIFT o Clic izquierdo: 0 de 2 cargas, la siguiente en \d s$/);
    // Inside the top bar, nothing out of the screen.
    const vitals = document.querySelector('.hud-vitals')!.getBoundingClientRect();
    const center = document.querySelector('.hud-center')!.getBoundingClientRect();
    expect(vitals.right).toBeLessThanOrEqual(center.left);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: `__shots__/hud-dash-${w}.png` });
  }, 120_000);
}
