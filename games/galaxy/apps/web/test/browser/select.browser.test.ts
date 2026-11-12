import { createElement, Fragment, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { Filters } from '../../src/collection/Filters';
import { DateField } from '../../src/ui/DateField';
import { Dialog } from '../../src/ui/Dialog';
import { Select, type SelectOption } from '../../src/ui/Select';
import '../../src/styles/app.css';

// The game's own dropdown in a real Chromium with the app's styles (C1): its list lives on <body>, so neither a panel
// that scrolls nor a dialog clips it; it flips above near the bottom of the window and keeps a CSS zoom of the large
// screens. The admin's calendar (ui/DateField.tsx) too. At 1280×720 and 1920×1080. With VITE_SELECT_SHOTS=1 it saves
// screenshots to __shots__/.

const SHOTS = !!import.meta.env['VITE_SELECT_SHOTS'];
const SIZES = [
  [1280, 720],
  [1920, 1080],
] as const;
const SECTORS: SelectOption[] = [
  'Cinturón de Kuiper',
  'Nebulosa del Cangrejo',
  'Brazo de Orión',
  'Vacío de Boötes',
  'Cúmulo de Virgo',
  'Gran Atractor',
  'Nube de Magallanes',
  'Anillo de Einstein',
  'Fisura del Núcleo',
  'Eco Profundo',
].map((label, i) => ({ value: `s${i}`, label, ...(i === 6 ? { disabled: true } : {}) }));

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
});

function Sector({ label = 'Sector' }: { label?: string }) {
  const [value, setValue] = useState('s2');
  return createElement(
    Fragment,
    null,
    createElement('label', { htmlFor: 'sector', className: 'cf-label' }, label),
    createElement(Select, { id: 'sector', value, options: SECTORS, onChange: setValue }),
  );
}

function mount(node: ReturnType<typeof createElement>, css = ''): HTMLElement {
  host = document.createElement('div');
  host.style.cssText = css;
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(node));
  return host;
}

async function openIt(): Promise<{ trigger: HTMLElement; list: HTMLElement }> {
  const trigger = document.querySelector<HTMLElement>('[role="combobox"]')!;
  trigger.click();
  await frames();
  await wait(200);
  const list = document.getElementById(trigger.getAttribute('aria-controls')!)!;
  // Its opening glide (a few px) must be over before measuring: a loaded CI runner measured it mid-way.
  await Promise.all(list.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined)));
  await frames();
  return { trigger, list };
}

/**
 * The whole list is inside the window and nothing covers it: what is on screen at each option it shows is that option.
 * A list taller than its cap scrolls inside, down to its last option.
 */
function expectFullyVisible(list: HTMLElement): void {
  const r = list.getBoundingClientRect();
  expect(r.top).toBeGreaterThanOrEqual(0);
  expect(r.left).toBeGreaterThanOrEqual(0);
  expect(r.bottom).toBeLessThanOrEqual(window.innerHeight);
  expect(r.right).toBeLessThanOrEqual(window.innerWidth);
  const options = [...list.querySelectorAll<HTMLElement>('[role="option"]')];
  const check = () => {
    const shown = options.filter((option) => {
      const o = option.getBoundingClientRect();
      return o.top >= r.top && o.bottom <= r.bottom;
    });
    expect(shown.length).toBeGreaterThanOrEqual(Math.min(options.length, 5));
    for (const option of shown) {
      const o = option.getBoundingClientRect();
      expect(option.contains(document.elementFromPoint(o.left + o.width / 2, o.top + o.height / 2))).toBe(true);
    }
    return shown;
  };
  check();
  const top = list.scrollTop;
  list.scrollTop = list.scrollHeight;
  expect(check()).toContain(options.at(-1));
  list.scrollTop = top;
}

test.each(SIZES)('dentro de un panel que se desplaza, la lista sale entera y sin recortar a %i×%i', async (w, h) => {
  await page.viewport(w, h);
  const panel = mount(
    createElement(
      'div',
      { className: 'lip panel', style: { width: '420px', height: '240px', overflow: 'auto', padding: '24px', borderRadius: '22px' } },
      createElement('p', { style: { height: '130px', margin: 0 } }, 'Ajustes de la sala'),
      createElement(Sector),
      createElement('p', { style: { height: '400px' } }, 'Más ajustes'),
    ),
    'position: absolute; left: 80px; top: 120px;',
  );
  const { trigger, list } = await openIt();
  const box = panel.firstElementChild!.getBoundingClientRect();
  expect(list.parentElement).toBe(document.body);
  expect(list.getBoundingClientRect().bottom).toBeGreaterThan(box.bottom);
  expect(list.getBoundingClientRect().top).toBeGreaterThanOrEqual(trigger.getBoundingClientRect().bottom);
  expect(list.getBoundingClientRect().width).toBeGreaterThanOrEqual(trigger.getBoundingClientRect().width - 1);
  expectFullyVisible(list);
  if (SHOTS) await page.screenshot({ path: `__shots__/select-panel-${w}.png` });

  // Scrolling the panel carries the list with its trigger.
  const before = list.getBoundingClientRect().top;
  (panel.firstElementChild as HTMLElement).scrollTop = 40;
  await frames();
  expect(Math.round(before - list.getBoundingClientRect().top)).toBe(40);
});

test.each(SIZES)('dentro de un diálogo, la lista queda por encima del velo y Escape solo la cierra a %i×%i', async (w, h) => {
  await page.viewport(w, h);
  let closed = 0;
  mount(
    createElement(Dialog, {
      title: 'Crear sala',
      onClose: () => void closed++,
      children: [createElement('p', { key: 'p' }, 'Elige el sector de la incursión'), createElement(Sector, { key: 's' })],
    }),
  );
  const { trigger, list } = await openIt();
  expect(list.parentElement).toBe(document.body);
  expectFullyVisible(list);
  if (SHOTS) await page.screenshot({ path: `__shots__/select-dialog-${w}.png` });
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await frames();
  expect(document.getElementById(list.id)).toBeNull();
  expect(closed).toBe(0);
});

test.each(SIZES)('cerca del borde de abajo se abre hacia arriba a %i×%i', async (w, h) => {
  await page.viewport(w, h);
  mount(createElement(Sector), `position: fixed; left: 40px; bottom: 30px;`);
  const { trigger, list } = await openIt();
  expect(list.dataset['side']).toBe('top');
  expect(list.getBoundingClientRect().bottom).toBeLessThanOrEqual(trigger.getBoundingClientRect().top);
  expectFullyVisible(list);
  if (SHOTS) await page.screenshot({ path: `__shots__/select-up-${w}.png` });
});

test('en una pantalla con zoom (las grandes) la lista lleva el mismo zoom y queda pegada a su botón', async () => {
  await page.viewport(1920, 1080);
  mount(createElement(Sector), 'position: absolute; left: 100px; top: 100px; zoom: 1.25;');
  const { trigger, list } = await openIt();
  const t = trigger.getBoundingClientRect();
  const l = list.getBoundingClientRect();
  expect(Math.abs(l.left - t.left)).toBeLessThan(1.5);
  expect(Math.abs(l.top - (t.bottom + 6 * 1.25))).toBeLessThan(1.5);
  expect(l.width).toBeGreaterThanOrEqual(t.width - 1);
  const first = list.querySelector<HTMLElement>('[role="option"]')!;
  expect(Math.abs(first.getBoundingClientRect().height - 40 * 1.25)).toBeLessThan(1.5);
  expectFullyVisible(list);
});

function When() {
  const [value, setValue] = useState('2026-11-12T10:30');
  return createElement(
    'div',
    { className: 'field' },
    createElement('label', { htmlFor: 'empieza' }, 'Empieza'),
    createElement('div', { className: 'control' }, createElement(DateField, { id: 'empieza', time: true, value, onChange: setValue })),
  );
}

test.each(SIZES)('el calendario de las fechas del admin sale entero sobre un diálogo a %i×%i', async (w, h) => {
  await page.viewport(w, h);
  let closed = 0;
  mount(
    createElement(Dialog, {
      title: 'Publicar un aviso',
      className: 'admin-dialog',
      onClose: () => void closed++,
      children: [createElement('p', { key: 'p' }, 'Cuándo se ve el aviso'), createElement(When, { key: 'w' })],
    }),
  );
  const field = document.getElementById('empieza') as HTMLInputElement;
  expect(field.value).toBe('12/11/2026 10:30');
  const toggle = document.querySelector<HTMLElement>('.datefield-open')!;
  toggle.click();
  await frames();
  await wait(200);
  const pop = document.getElementById(toggle.getAttribute('aria-controls')!)!;
  expect(pop.parentElement).toBe(document.body);
  const r = pop.getBoundingClientRect();
  expect(r.top).toBeGreaterThanOrEqual(0);
  expect(r.left).toBeGreaterThanOrEqual(0);
  expect(r.bottom).toBeLessThanOrEqual(window.innerHeight);
  expect(r.right).toBeLessThanOrEqual(window.innerWidth);
  expect(pop.scrollHeight).toBeLessThanOrEqual(pop.clientHeight + 1);
  for (const el of pop.querySelectorAll<HTMLElement>('.datefield-day, .datefield-nav, .datefield-action, input')) {
    const b = el.getBoundingClientRect();
    expect(el.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2))).toBe(true);
  }
  expect(document.activeElement?.getAttribute('data-day')).toBe('2026-11-12');
  if (SHOTS) await page.screenshot({ path: `__shots__/datefield-dialog-${w}.png` });
  pop.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await frames();
  expect(document.getElementById(pop.id)).toBeNull();
  expect(closed).toBe(0);
});

test.each(SIZES)('en los filtros de la colección el desplegable encaja con las fichas y su lista sale entera a %i×%i', async (w, h) => {
  await page.viewport(w, h);
  mount(
    createElement(Filters, {
      filters: { sort: 'new' },
      counts: { common: 12, uncommon: 5, rare: 3, epic: 1, legendary: 0 },
      onChange: () => {},
    }),
    'position: absolute; left: 60px; top: 40px; width: min(1100px, calc(100vw - 120px)); padding: 20px; background: #11132e;',
  );
  const trigger = document.querySelector<HTMLElement>('[role="combobox"]')!;
  const chip = document.querySelector<HTMLElement>('.chip')!;
  expect(Math.round(trigger.getBoundingClientRect().height)).toBe(Math.round(chip.getBoundingClientRect().height));
  const { list } = await openIt();
  expectFullyVisible(list);
  if (SHOTS) await page.screenshot({ path: `__shots__/select-filters-${w}.png` });
});
