import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { DesktopGate, isDesktopCapable } from '../src/shell/DesktopGate';

// The minimum is the SCREEN (GDD §2: 1280×720), not the browser viewport: on a real 1280×720 or 1366×768 laptop the
// browser chrome eats ~100 px of height and the game must still open (the layout scrolls if the window is short).
const win = (w: number, h: number, fine: boolean) => ({
  screen: { width: w, height: h },
  matchMedia: (q: string) => ({ matches: q === '(pointer: fine)' ? fine : false }),
});

test.each([
  [1279, 720, true, false],
  [1280, 719, true, false],
  [1280, 720, true, true],
  [1366, 768, true, true],
  [3440, 1440, true, true],
  [1920, 1080, false, false],
])('pantalla %ix%i puntero fino=%s → %s', (w, h, fine, expected) => {
  expect(isDesktopCapable(win(w, h, fine))).toBe(expected);
});

test('en una pantalla pequeña muestra el aviso en vez del juego', () => {
  render(
    <DesktopGate win={win(1024, 700, true)}>
      <p>juego</p>
    </DesktopGate>,
  );
  expect(screen.getByRole('heading', { name: 'Galaxy Survivor se juega en ordenador' })).toBeInTheDocument();
  expect(screen.queryByText('juego')).not.toBeInTheDocument();
});

test('en escritorio muestra el juego', () => {
  render(
    <DesktopGate win={win(1600, 900, true)}>
      <p>juego</p>
    </DesktopGate>,
  );
  expect(screen.getByText('juego')).toBeInTheDocument();
});
