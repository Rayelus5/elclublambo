import type { PulledGalaxy, Tier } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import type { CinemaControl } from '../../src/scanner/pro/ProCinema';
import { ProShell } from '../../src/scanner/pro/ProShell';
import type { Phase } from '../../src/scanner/pro/script';
import '../../src/styles/app.css';

// The pro scanner in a real browser (plan «escáner pro», part B): the bands close while the request is out, the
// cinema starts when the galaxies arrive, every phase draws inside the screen, «Saltar» lands on the summary, and the
// WebGL context is given back on close. VITE_REVEAL_SHOTS=1 saves a screenshot of each phase.

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let n = 0;
function pull(tier: Tier, extra: Partial<PulledGalaxy> = {}): PulledGalaxy {
  n++;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    seed: String(918_273_645 + n * 7919),
    tier,
    finish: 'normal',
    traits: { phenomenon: 'none', palette: 'nebula' },
    name: ['Kathra Vel', 'Orion Sur', 'Lyra Tenue', 'Deneb Alta', 'Vega Prima'][n % 5]!,
    designation: `GX-${n}A${n}F`,
    featured: false,
    ...extra,
  };
}

function mount(pulls: readonly PulledGalaxy[] | null, hooks: { control?: CinemaControl | null; phase?: Phase | null }) {
  const host = document.createElement('div');
  document.body.append(host);
  root ??= createRoot(host);
  const render = (p: readonly PulledGalaxy[] | null) =>
    flushSync(() =>
      root!.render(
        createElement(
          QueryClientProvider,
          { client: new QueryClient() },
          createElement(
            MemoryRouter,
            null,
            createElement(ProShell, {
              pulls: p,
              onClose: () => {},
              direction: { surge: true },
              rehearsal: (control: CinemaControl | null, phase: Phase | null) => {
                hooks.control = control;
                hooks.phase = phase;
                return null;
              },
            }),
          ),
        ),
      ),
    );
  render(pulls);
  return render;
}

async function until(check: () => boolean, ms = 15_000) {
  const end = performance.now() + ms;
  while (!check()) {
    if (performance.now() > end) throw new Error('timeout');
    await wait(50);
  }
}

for (const [label, pulls] of [
  ['una-legendaria', () => [pull('legendary', { featured: true, finish: 'holo', traits: { phenomenon: 'pulsar', palette: 'nebula' } })]],
  ['diez', () => [pull('common'), pull('rare'), pull('common'), pull('uncommon'), pull('epic', { finish: 'prismatic' }), pull('common'), pull('legendary'), pull('common'), pull('uncommon'), pull('common')]],
] as const) {
  test(`la cinemática pro (${label}) dibuja cada fase dentro de la pantalla y Saltar lleva al resumen`, async () => {
    await page.viewport(1600, 900);
    const hooks: { control?: CinemaControl | null; phase?: Phase | null } = {};
    const render = mount(null, hooks);
    const rootEl = document.querySelector<HTMLElement>('.pro-root')!;
    expect(rootEl.dataset['state']).toBe('closing');
    // The bands close: black, top to bottom. A loaded runner may not move their 0.6 s transition along at all, so the
    // test finishes it by hand: what it checks is where the bands end.
    const bar = document.querySelector<HTMLElement>('.pro-bar.top')!;
    await until(() => {
      if (bar.getBoundingClientRect().height > 440) return true;
      for (const a of bar.getAnimations()) a.finish();
      return false;
    }, 5000);
    if (import.meta.env['VITE_REVEAL_SHOTS']) await page.screenshot({ path: `__shots__/pro-${label}-0-cierre.png` });
    render(pulls());
    // A rehearsal render gets the control once the cinema runs; it re-renders on each phase.
    await until(() => !!hooks.control && !!document.querySelector('.pro-canvas'));
    const control = hooks.control!;
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1600);
    for (const p of control.script.phases) {
      if (p.kind === 'resumen') continue;
      const face = control.script.faces.find((f) => f.slot === p.slot)?.at;
      const at =
        p.kind === 'solo' && face !== undefined
          ? face + 0.7
          : p.kind === 'carta'
            ? p.at + p.dur * 0.85
            : p.kind === 'impacto'
              ? p.at + (p.lead ?? 0) + 0.12
              : p.kind === 'caida'
                ? p.at + p.dur * 0.7
                : p.at + p.dur * 0.55;
      // The exact frame: jump there and hold still while the screenshot is taken.
      control.seek(at);
      control.pause();
      await wait(220);
      const canvas = document.querySelector<HTMLCanvasElement>('.pro-canvas')!;
      expect(canvas.clientWidth).toBe(1600);
      if (import.meta.env['VITE_REVEAL_SHOTS'] && (label === 'una-legendaria' || /^(salto|ascenso|caida|impacto|reparto|solo-9|solo-8|final|giro-4)$/.test(p.label))) {
        await page.screenshot({ path: `__shots__/pro-${label}-${String(control.script.phases.indexOf(p) + 1).padStart(2, '0')}-${p.label}.png` });
      }
      control.resume();
    }
    control.seek(control.script.phases.find((p) => p.kind === 'resumen')!.at - 2);
    await wait(400);
    expect(control.skip()).toBe(true);
    await until(() => !!document.querySelector('.pro-summary'));
    await wait(700);
    expect(document.querySelectorAll('.pro-summary .summary-card')).toHaveLength(pulls().length);
    if (import.meta.env['VITE_REVEAL_SHOTS']) await page.screenshot({ path: `__shots__/pro-${label}-99-resumen.png` });
  }, 90_000);
}
