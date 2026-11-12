import { act, render } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { spriteDataUrl } from '../src/arena/sprites';
import { SpriteLoop } from '../src/ui/SpriteLoop';

// Plan «skins», part C2: a drawing that moves outside the arena (the animated skins in the Taller, the lobby and the
// shop): its frames at its own pace, and still on its first one with reduced motion.

afterEach(() => vi.useRealTimers());

test('pasa los fotogramas de la skin a su ritmo', () => {
  vi.useFakeTimers();
  const { container } = render(<SpriteLoop id="skin-lumen-leyenda" scale={2} reduced={false} />);
  const img = container.querySelector('img')!;
  expect(img.getAttribute('src')).toBe(spriteDataUrl('skin-lumen-leyenda', 2, 0));
  act(() => vi.advanceTimersByTime(110));
  expect(img.getAttribute('src')).toBe(spriteDataUrl('skin-lumen-leyenda', 2, 1));
});

test('con movimiento reducido se queda en el primero', () => {
  vi.useFakeTimers();
  const { container } = render(<SpriteLoop id="skin-lumen-leyenda" scale={2} reduced />);
  act(() => vi.advanceTimersByTime(1000));
  expect(container.querySelector('img')!.getAttribute('src')).toBe(spriteDataUrl('skin-lumen-leyenda', 2, 0));
});
