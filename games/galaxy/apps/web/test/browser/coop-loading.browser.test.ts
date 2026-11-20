import type { CoopRunStart } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { CoopLoading } from '../../src/coop/CoopLoading';
import '../../src/styles/app.css';

// The loading screen before a group run (the owner, 2026-11-14): the sector in its biome's colours, the team with
// their probes and the steps with a bar, inside the screen. VITE_COOP_SHOTS=1 saves it.

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
});

const start = {
  sector: DEFAULT_CONTENT.sectors[1]!.id,
  content: DEFAULT_CONTENT,
  slot: 1,
  players: [
    { username: 'vega', probe: 'lumen', skin: 'skin-lumen-coral' },
    { username: 'rayelus', probe: 'spark', skin: null },
    { username: 'orion_7', probe: 'bastion', skin: null },
    { username: 'lyra', probe: 'comet', skin: null },
  ],
} as unknown as CoopRunStart;

for (const [width, height] of [
  [1280, 720],
  [1920, 1080],
] as const) {
  test(`la carga de una incursión en grupo cabe y dice sus pasos a ${width}×${height}`, async () => {
    await page.viewport(width, height);
    document.body.style.margin = '0';
    const host = document.createElement('div');
    host.className = 'arena coop-arena';
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(createElement(CoopLoading, { start, step: 'arena' }));
    await new Promise((r) => setTimeout(r, 700));
    const screen = document.querySelector<HTMLElement>('.coop-loading')!;
    expect(screen.getAttribute('role')).toBe('status');
    expect(screen.getAttribute('aria-busy')).toBe('true');
    expect(screen.querySelector('.coop-loading-sector')!.textContent).toBe(DEFAULT_CONTENT.sectors[1]!.name);
    const team = [...screen.querySelectorAll('.coop-loading-team li')];
    expect(team).toHaveLength(4);
    expect(team[1]!.classList.contains('me')).toBe(true);
    expect(team[1]!.textContent).toContain('Tú');
    const steps = [...screen.querySelectorAll('.coop-loading-steps li')].map((li) => li.className);
    expect(steps).toEqual(['done', 'now', '', '']);
    const card = screen.querySelector('.coop-loading-card')!.getBoundingClientRect();
    expect(card.bottom).toBeLessThanOrEqual(height);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    if (import.meta.env['VITE_COOP_SHOTS']) await page.screenshot({ path: `__shots__/coop-loading-${width}.png` });
  });
}

// The start (2026-11-17): the countdown over the arena already drawn (see-through), with who is in on each card, at
// both sizes; the arena shows through around the card. VITE_COOP_SHOTS=1 saves it.
for (const [width, height] of [
  [1280, 720],
  [1920, 1080],
] as const) {
  test(`la cuenta atrás deja ver la arena y dice quién está a ${width}×${height}`, async () => {
    await page.viewport(width, height);
    document.body.style.margin = '0';
    const host = document.createElement('div');
    host.className = 'arena coop-arena';
    // Something bright behind, as the arena would be.
    host.style.cssText = 'position:fixed;inset:0;background:repeating-linear-gradient(45deg,#ffc94a 0 40px,#45e3a6 40px 80px)';
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(createElement(CoopLoading, { start, step: 'count', see: true, countdown: 3, connected: [true, true, false, true] }));
    await new Promise((r) => setTimeout(r, 700));
    const screen = document.querySelector<HTMLElement>('.coop-loading')!;
    expect(screen.classList.contains('see')).toBe(true);
    // See-through: no solid backdrop under the veil (before, the void colour covered the arena).
    expect(getComputedStyle(screen).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(screen.querySelector('.coop-loading-count')!.textContent).toBe('3');
    const nets = [...screen.querySelectorAll('.coop-loading-team li .coop-loading-net')].map((n) => n.getAttribute('data-on'));
    expect(nets).toEqual(['true', 'true', 'false', 'true']);
    const card = screen.querySelector('.coop-loading-card')!.getBoundingClientRect();
    expect(card.bottom).toBeLessThanOrEqual(height);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    if (import.meta.env['VITE_COOP_SHOTS']) await page.screenshot({ path: `__shots__/coop-countdown-${width}.png` });
  });
}
