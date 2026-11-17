import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Icon } from '../src/ui/Icon';

// Icons on a colour (the owner, 2026-11-17: «iconos blancos… pero que se sigan viendo, añadir un contorno»): an outlined
// icon draws its strokes twice, a wider dark copy behind and the icon itself on top, so it reads on any tone.

test('un icono con contorno dibuja sus trazos dos veces: una copia oscura detrás y el icono delante', () => {
  const { container } = render(<Icon name="wrench" outline />);
  const svg = container.querySelector('svg')!;
  expect(svg).toHaveClass('ico', 'ico-ol');
  expect(svg).toHaveAttribute('aria-hidden', 'true');
  const back = svg.querySelector('g.ico-back');
  expect(back).not.toBeNull();
  // The same drawing behind and in front, the copy first so it sits underneath.
  expect(back!.innerHTML).toBe(svg.querySelector(':scope > path')!.outerHTML);
  expect(svg.firstElementChild).toBe(back);
});

test('un icono normal no cambia: un solo trazo y sin contorno', () => {
  const { container } = render(<Icon name="wrench" />);
  const svg = container.querySelector('svg')!;
  expect(svg).not.toHaveClass('ico-ol');
  expect(svg.querySelector('.ico-back')).toBeNull();
});

test('con una clase propia, el contorno se suma a ella', () => {
  const { container } = render(<Icon name="coin" className="ico big" outline />);
  expect(container.querySelector('svg')).toHaveClass('ico', 'big', 'ico-ol');
});
