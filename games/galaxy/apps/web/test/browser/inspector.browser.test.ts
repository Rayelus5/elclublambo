import { FINISHES, type Finish, type GalaxySummary } from '@galaxy/shared';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { Inspector } from '../../src/inspector/Inspector';
import '../../src/styles/app.css';

// The 3D inspector (GDD §8.1) in a real Chromium: three.js arrives only when it opens, the card is drawn with every
// finish, closing gives the WebGL context back, and without WebGL2 the player still sees the flat card.
const galaxy = (finish: Finish): GalaxySummary => ({
  id: `g-${finish}`,
  seed: '424242',
  tier: 'legendary',
  finish,
  traits: { galaxy_type: 'spiral', palette: 'solar_gold', phenomenon: 'none' },
  name: 'Kathra',
  designation: 'GX-ABC123',
  featured: false,
  level: 2,
  createdAt: '2026-11-06T20:00:00Z',
});

const until = async (check: () => boolean, ms = 60_000) => {
  const start = performance.now();
  while (!check()) {
    if (performance.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
};
const sceneLoaded = () => performance.getEntriesByType('resource').some((e) => /inspector-scene|\/three\b|three\.js|three_/.test(e.name));

let root: Root | null = null;
function open(g: GalaxySummary, onClose = () => {}) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(createElement(Inspector, { galaxy: g, onClose })));
}
function close() {
  flushSync(() => root?.unmount());
  root = null;
}
const state = () => document.querySelector<HTMLElement>('.inspector')?.dataset['state'];
afterEach(() => {
  close();
  vi.restoreAllMocks();
});

test('three.js solo se descarga al abrir el inspector', { timeout: 90_000 }, async () => {
  expect(sceneLoaded()).toBe(false);
  open(galaxy('normal'));
  await until(() => state() === 'ready');
  expect(sceneLoaded()).toBe(true);
});

test('el lienzo dibuja la carta con cada acabado', { timeout: 120_000 }, async () => {
  await page.viewport(1280, 800);
  for (const finish of FINISHES) {
    open(galaxy(finish));
    await until(() => state() === 'ready');
    await new Promise((r) => setTimeout(r, 250));
    const gl = document.querySelector<HTMLCanvasElement>('.inspector canvas')!;
    const probe = document.createElement('canvas');
    probe.width = gl.width;
    probe.height = gl.height;
    const ctx = probe.getContext('2d')!;
    ctx.drawImage(gl, 0, 0);
    const { data } = ctx.getImageData(0, 0, probe.width, probe.height);
    let lit = 0;
    for (let i = 0; i < data.length; i += 16) if (data[i]! + data[i + 1]! + data[i + 2]! > 120) lit++;
    expect(lit, finish).toBeGreaterThan(data.length / 16 / 20);
    expect(document.querySelector('.inspector')!.getAttribute('data-finish')).toBe(finish);
    if (import.meta.env['VITE_CARD_SHOTS']) {
      // Under the pointer (tilted, the finish lit), for the visual review.
      const r = gl.getBoundingClientRect();
      gl.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + r.width * 0.68, clientY: r.top + r.height * 0.32 }));
      await new Promise((res) => setTimeout(res, 900));
      await page.screenshot({ path: `__shots__/inspector-${finish}.png`, element: document.querySelector('.inspector')! });
      if (finish === 'braille') {
        (document.querySelector('.inspector-actions button[aria-pressed]') as HTMLButtonElement).click();
        await new Promise((res) => setTimeout(res, 1500));
        await page.screenshot({ path: '__shots__/inspector-back.png', element: document.querySelector('.inspector')! });
      }
    }
    close();
  }
});

test('cerrar el inspector libera su contexto WebGL', { timeout: 90_000 }, async () => {
  open(galaxy('holo'));
  await until(() => state() === 'ready');
  const canvas = document.querySelector<HTMLCanvasElement>('.inspector canvas')!;
  close();
  expect(canvas.getContext('webgl2')?.isContextLost() ?? true).toBe(true);
});

test('sin WebGL2 el inspector enseña la carta plana por las dos caras', { timeout: 60_000 }, async () => {
  const real = HTMLCanvasElement.prototype.getContext;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
    return type === 'webgl2' ? null : (real as (...a: unknown[]) => RenderingContext | null).call(this, type, ...rest);
  } as typeof real);
  open(galaxy('prismatic'));
  await until(() => state() === 'flat');
  const inspector = document.querySelector('.inspector')!;
  expect(inspector.querySelectorAll('article')).toHaveLength(2);
  expect(inspector.querySelector('canvas.inspector-gl')).toBeNull();
});
