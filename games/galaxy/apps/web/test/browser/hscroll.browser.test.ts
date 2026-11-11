import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { HScroll } from '../../src/ui/HScroll';
import '../../src/styles/app.css';

// No scrollbars anywhere, in a real Chromium (the owner's request): a strip wider than its place keeps no room for a
// bar, scrolls sideways with the mouse wheel and with its arrows, and fades the side where there is more. With
// VITE_SCROLL_SHOTS=1 it saves a screenshot.
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('una tira más ancha que su sitio no enseña barra, se mueve con la rueda y con sus flechas', async () => {
  await page.viewport(1200, 600);
  const host = document.createElement('div');
  host.style.cssText = 'width: 520px; padding: 24px; background: #11132e;';
  document.body.append(host);
  const items = Array.from({ length: 12 }, (_, i) =>
    createElement('li', { key: i, style: { flex: 'none', width: '140px', height: '90px', borderRadius: '16px', background: `hsl(${i * 30} 70% 55%)` } }, String(i + 1)),
  );
  flushSync(() => createRoot(host).render(createElement(HScroll, { as: 'ol', className: 'lobby-slots', label: 'Reliquias', 'aria-label': 'Reliquias', children: items })));
  await wait(50);
  const list = host.querySelector<HTMLElement>('ol')!;
  expect(getComputedStyle(list).scrollbarWidth).toBe('none');
  expect(list.offsetHeight - list.clientHeight).toBe(0);
  expect(list.scrollWidth).toBeGreaterThan(list.clientWidth);
  expect(host.querySelector('.hscroll-arrow.prev')).toBeNull();
  const next = host.querySelector<HTMLButtonElement>('.hscroll-arrow.next')!;
  expect(next).not.toBeNull();
  if (import.meta.env['VITE_SCROLL_SHOTS']) await page.screenshot({ path: '__shots__/hscroll-start.png', element: host });

  const turned = list.dispatchEvent(new WheelEvent('wheel', { deltaY: 200, bubbles: true, cancelable: true }));
  expect(turned).toBe(false);
  expect(list.scrollLeft).toBe(200);

  next.click();
  // A smooth scroll: its pace depends on the machine, so wait for it rather than for a fixed time.
  await expect.poll(() => list.scrollLeft, { timeout: 5000 }).toBeGreaterThan(300);
  await expect.poll(() => host.querySelector('.hscroll-arrow.prev'), { timeout: 2000 }).not.toBeNull();
  if (import.meta.env['VITE_SCROLL_SHOTS']) await page.screenshot({ path: '__shots__/hscroll-middle.png', element: host });
  host.remove();
});

test('la página tampoco enseña barra aunque sea más alta que la ventana', async () => {
  await page.viewport(1200, 400);
  const tall = document.createElement('div');
  tall.style.height = '3000px';
  document.body.append(tall);
  expect(getComputedStyle(document.documentElement).scrollbarWidth).toBe('none');
  expect(window.innerWidth - document.documentElement.clientWidth).toBe(0);
  tall.remove();
});
