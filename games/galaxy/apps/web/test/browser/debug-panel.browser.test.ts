import type { RunStart } from '@galaxy/shared';
import { DEFAULT_CONTENT, type Sim } from '@galaxy/sim';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { ArenaScreen } from '../../src/arena/ArenaScreen';
import { copy } from '../../src/copy/es';
import '../../src/styles/app.css';

// The admin debug mode in a real browser (2026-11-15): the side panel, the read-out and the collisions over the run,
// from a laptop to a large screen, inside the screen (nothing goes sideways). With VITE_ARENA_SHOTS=1 it saves
// screenshots for review.

const run: RunStart = {
  id: '00000000-0000-4000-8000-000000000003',
  seed: '20261115',
  sector: 'outer-nebula',
  probe: 'lumen',
  relics: [],
  bonuses: [],
  variant: null,
  anomaly: null,
  skin: null,
  content: DEFAULT_CONTENT,
  contentVersion: 12,
  startedAt: '2026-11-15T10:00:00.000Z',
};

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === name);

test.each([
  [1280, 720],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
])('el panel de depuración a %ix%i: dentro de la pantalla, con información y colisiones', async (width, height) => {
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
        sim ??= s;
      },
      debug: { test: true, draft: false, markTest: async () => {} },
    }),
  );
  await vi.waitFor(() => expect(sim).not.toBeNull(), { timeout: 20_000 });
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F2', key: 'F2' }));
  await vi.waitFor(() => expect(document.querySelector('.debug-panel')).not.toBeNull());
  button(copy.arena.debug.info)?.click();
  button(copy.arena.debug.hitboxes)?.click();
  button(copy.arena.debug.god)?.click();
  document.querySelector<HTMLElement>('.debug-list li')?.click();
  await vi.waitFor(() => expect(document.querySelector('.debug-info')).not.toBeNull());
  await new Promise((r) => setTimeout(r, 900));
  // A busy browser may lose the window's focus, which pauses the run: the panel stays and the pause dialog waits.
  const panel = document.querySelector<HTMLElement>('.debug-panel')!.getBoundingClientRect();
  const info = document.querySelector<HTMLElement>('.debug-info')!.getBoundingClientRect();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  expect(panel.right).toBeLessThanOrEqual(width);
  expect(panel.bottom).toBeLessThanOrEqual(height);
  expect(info.left).toBeGreaterThanOrEqual(0);
  expect(info.bottom).toBeLessThanOrEqual(height);
  // The panel and the read-out never cover each other.
  expect(info.right).toBeLessThan(panel.left);
  if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: `__shots__/debug-${width}.png` });
});
