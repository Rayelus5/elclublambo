import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { HScroll } from '../src/ui/HScroll';

// What scrolls sideways with no scrollbar (the owner's request): arrows only where there is more, the mouse wheel
// moves a strip sideways until its end (then the page takes it), and a table leaves the wheel to the page.

/** jsdom has no layout: the strip's sizes and scroll, by hand. */
function sized(el: HTMLElement, scrollWidth: number, clientWidth: number, at = 0) {
  let left = at;
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
  Object.defineProperty(el, 'scrollLeft', { configurable: true, get: () => left, set: (v: number) => (left = v) });
  act(() => {
    fireEvent.scroll(el);
  });
}

const strip = (variant?: 'strip' | 'table') =>
  render(
    <HScroll as="ul" variant={variant} label="Reliquias" aria-label="Reliquias">
      <li>Una</li>
      <li>Otra</li>
    </HScroll>,
  );

test('si todo cabe, no hay flechas', () => {
  strip();
  sized(screen.getByRole('list'), 300, 300);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('con más a la derecha sale «ver más»; al final, solo «ver anteriores»', async () => {
  strip();
  const list = screen.getByRole('list');
  sized(list, 900, 300);
  expect(screen.queryByRole('button', { name: copy.scroll.prevOf('Reliquias') })).not.toBeInTheDocument();
  list.scrollBy = vi.fn();
  await userEvent.click(screen.getByRole('button', { name: copy.scroll.nextOf('Reliquias') }));
  expect(list.scrollBy).toHaveBeenCalledWith({ left: 240, behavior: 'smooth' });
  sized(list, 900, 300, 600);
  expect(screen.getByRole('button', { name: copy.scroll.prevOf('Reliquias') })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: copy.scroll.nextOf('Reliquias') })).not.toBeInTheDocument();
});

test('la rueda del ratón lo mueve de lado hasta su final; ahí la rueda vuelve a ser de la página', () => {
  strip();
  const list = screen.getByRole('list');
  sized(list, 900, 300);
  // fireEvent returns false when the event was cancelled (the page does not scroll).
  expect(fireEvent.wheel(list, { deltaY: 100 })).toBe(false);
  expect(list.scrollLeft).toBe(100);
  sized(list, 900, 300, 600);
  expect(fireEvent.wheel(list, { deltaY: 100 })).toBe(true);
  expect(list.scrollLeft).toBe(600);
  expect(fireEvent.wheel(list, { deltaY: -50 })).toBe(false);
  expect(list.scrollLeft).toBe(550);
});

test('una tabla deja la rueda a la página y también tiene sus flechas', () => {
  strip('table');
  const list = screen.getByRole('list');
  sized(list, 900, 300);
  expect(fireEvent.wheel(list, { deltaY: 100 })).toBe(true);
  expect(screen.getByRole('button', { name: copy.scroll.nextOf('Reliquias') })).toBeInTheDocument();
});
