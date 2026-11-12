import type { AdminRunReplay, SoloWatchMessage } from '@galaxy/shared';
import { botInput, botPick, createSim, DEFAULT_CONTENT, encodeEvents, encodeLog, step, toBase64 } from '@galaxy/sim';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { SoloWatchScreen, type WatchSocket } from '../../src/admin/SoloWatchScreen';
import '../../src/styles/app.css';

// A solo run watched live in a real browser (plan «escáner pro», part G): the hello's log (40 s of a bot's run) is
// caught up, the arena is drawn with its HUD, a later piece carries it on, and the page never grows sideways.
// Screenshots with VITE_SOLO_SHOTS=1.

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
});

const start: AdminRunReplay['start'] = { seed: '20261112', sector: 'outer-nebula', probe: 'lumen', relics: [], bonuses: [], variant: null, anomaly: null, content: DEFAULT_CONTENT };

function recorded(ticks: number) {
  const sim = createSim({ seed: start.seed, content: DEFAULT_CONTENT, sector: start.sector, probes: [{ probe: 'lumen', relics: [], bonuses: [], variant: null }], anomaly: null, record: true });
  while (sim.tick < ticks && (sim.status === 'running' || sim.status === 'choosing')) {
    if (sim.status === 'choosing') step(sim, [{ mx: 0, my: 0, aim: -1, pick: botPick(sim.probes[0]!.offer!) }]);
    else step(sim, [botInput(sim, 0)]);
  }
  return sim;
}

class Sock implements WatchSocket {
  static last: Sock | null = null;
  readyState = 1;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    Sock.last = this;
  }
  close() {
    this.readyState = 3;
  }
  push(m: SoloWatchMessage) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}

for (const [w, h] of [
  [1280, 720],
  [1920, 1080],
] as const) {
  test(`el directo de una incursión en solitario a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    Sock.last = null;
    const host = document.createElement('div');
    document.body.style.margin = '0';
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(
          MemoryRouter,
          { initialEntries: ['/admin/moderacion/directo/solo/r1'] },
          createElement(Routes, null, createElement(Route, { path: '/admin/moderacion/directo/solo/:runId', element: createElement(SoloWatchScreen, { open: () => new Sock() }) })),
        ),
      ),
    );
    const full = recorded(3000);
    const ev = full.log!.events;
    let cut = 0;
    while (cut + 5 < ev.length && ev[cut]! <= 2400) cut += 6;
    await expect.poll(() => Sock.last).not.toBeNull();
    Sock.last!.push({ t: 'hello', run: { id: 'r1', player: 'vega', startedAt: '2026-11-12T10:00:00.000Z' }, start, contentFallback: false, log: toBase64(encodeLog({ probes: 1, events: ev.slice(0, cut) })), to: 2400, s: 'run' });
    // It catches up, and then nothing is said over the arena while it plays.
    await expect.poll(() => document.querySelector('.solo-status')?.textContent ?? 'x', { timeout: 15_000 }).toBe('');
    Sock.last!.push({ t: 'f', b: toBase64(encodeEvents(ev.slice(cut), ev[cut - 6]!).bytes), to: full.tick, s: 'run' });
    await new Promise((r) => setTimeout(r, 1500));
    const canvas = document.querySelector<HTMLCanvasElement>('.replay-stage canvas')!;
    expect(canvas.width).toBeGreaterThan(300);
    expect(document.querySelector('.hud-xp')).not.toBeNull();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    if (import.meta.env['VITE_SOLO_SHOTS']) await page.screenshot({ path: `__shots__/solo-watch-${w}.png` });
    Sock.last!.push({ t: 'st', s: 'pause' });
    // The later piece may still be catching up on a slow runner («Sincronizando…» first).
    await expect.poll(() => document.querySelector('.solo-status')?.textContent, { timeout: 15_000 }).toBe('El jugador tiene el juego en pausa');
  }, 60_000);
}
