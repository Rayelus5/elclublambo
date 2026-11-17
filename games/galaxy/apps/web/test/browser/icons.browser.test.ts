import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { Rail } from '../../src/hangar/lobby/Rail';
import { Icon } from '../../src/ui/Icon';
import '../../src/styles/app.css';

// Icons on a colour (the owner, 2026-11-17: «iconos blancos en vez de negros en los botones de colección, estación…
// pero que se sigan viendo, añadir un contorno»): every icon on a coloured tile is white with a dark rim, the game's
// pixel-icon outline (#0b0c24), whatever the tone. VITE_ICON_SHOTS=1 saves screenshots.

const WHITE = 'rgb(255, 255, 255)';
const RIM = 'rgb(11, 12, 36)';

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function mount(node: ReturnType<typeof createElement>) {
  vi.stubGlobal('fetch', () => new Promise(() => {}));
  const host = document.createElement('div');
  host.style.cssText = 'padding:24px;display:flex;gap:24px;align-items:flex-start;background:#0b0d2a';
  document.body.append(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root.render(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, node)));
  return host;
}

/** The front strokes and the rim behind, as the browser paints them. */
function strokes(svg: SVGSVGElement) {
  const back = svg.querySelector('.ico-back > *');
  const front = svg.querySelector(':scope > :not(.ico-back)');
  return { back: back ? getComputedStyle(back).stroke : null, front: front ? getComputedStyle(front).stroke : null };
}

test('los seis iconos de la barra del lobby son blancos con contorno oscuro, sea cual sea su color', async () => {
  await page.viewport(1600, 900);
  const host = mount(createElement(Rail));
  await expect.poll(() => host.querySelectorAll('.lobby-zone-icon svg').length).toBe(6);
  for (const svg of host.querySelectorAll<SVGSVGElement>('.lobby-zone-icon svg')) {
    expect(strokes(svg), svg.closest('a')!.className).toEqual({ front: WHITE, back: RIM });
  }
  // A cartoon depth (the owner, 2026-11-17: «más grueso, que tienda a estar más a la izquierda y abajo que en el centro
  // y que sea menos oscuro»): a thick rim, shifted down and to the left, half see-through so the tile's colour tints it.
  const svg = host.querySelector<SVGSVGElement>('.lobby-zone-icon svg')!;
  const back = svg.querySelector<SVGGElement>('.ico-back')!;
  const shift = new DOMMatrix(getComputedStyle(back).transform);
  expect(shift.e).toBeLessThan(-0.5);
  expect(shift.f).toBeGreaterThan(0.5);
  // Light (the owner, twice: «menos oscuro», «más clarito»): about a third of the dark.
  expect(Number(getComputedStyle(back).opacity)).toBeGreaterThan(0.15);
  expect(Number(getComputedStyle(back).opacity)).toBeLessThanOrEqual(0.35);
  expect(parseFloat(getComputedStyle(back.firstElementChild!).strokeWidth)).toBeGreaterThanOrEqual(5.5);
  if (import.meta.env['VITE_ICON_SHOTS']) {
    // After the rail's entrance; the second shot is a close-up (zoom 3) to judge the rim.
    await new Promise((r) => setTimeout(r, 900));
    await page.screenshot({ path: '__shots__/icons-rail-1600.png', element: host.querySelector<HTMLElement>('.lobby-rail')! });
    host.style.zoom = '3';
    await page.screenshot({ path: '__shots__/icons-rail-zoom.png', element: host.querySelector<HTMLElement>('.lobby-rail')! });
  }
});

test('los iconos sobre color fuera de la barra también: la píldora del escáner, las fichas del título, Solo, el «+» y el escaneo gratis', async () => {
  await page.viewport(1600, 900);
  const icon = (name: 'radar' | 'station' | 'probe' | 'plus') => createElement(Icon, { name, outline: true });
  const host = mount(
    createElement(
      Fragment,
      null,
      createElement('span', { className: 'lip pill pill-solar' }, icon('radar'), createElement('span', null, 'Escáner')),
      createElement('span', { className: 'lip mode m-nova' }, createElement('span', { className: 'chip' }, icon('radar'))),
      createElement('span', { className: 'lip mode m-terminal' }, createElement('span', { className: 'chip' }, icon('station'))),
      createElement('button', { type: 'button', role: 'radio', 'aria-checked': true, className: 'lip lobby-mode solo' }, icon('probe'), createElement('b', null, 'Solo')),
      createElement('button', { type: 'button', className: 'lobby-slot-add' }, icon('plus'), createElement('span', null, 'Elegir')),
      createElement('button', { type: 'button', className: 'lip pull-free' }, icon('radar'), createElement('b', null, 'Gratis')),
    ),
  );
  await expect.poll(() => host.querySelectorAll('svg').length).toBe(6);
  for (const svg of host.querySelectorAll<SVGSVGElement>('svg')) expect(strokes(svg), svg.parentElement!.className).toEqual({ front: WHITE, back: RIM });
  // The text beside them keeps its own colour (dark on the bright fills).
  expect(getComputedStyle(host.querySelector('.pill-solar span')!).color).not.toBe(WHITE);
  if (import.meta.env['VITE_ICON_SHOTS']) await page.screenshot({ path: '__shots__/icons-chips-1600.png', element: host });
});
