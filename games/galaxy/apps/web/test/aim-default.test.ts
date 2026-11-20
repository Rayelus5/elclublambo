import { afterEach, beforeEach, expect, test } from 'vitest';
import { manualAim, setManualAim } from '../src/arena/settings';

// The owner: «Apuntar con el ratón» on by default, also for everyone who had it off. A player without a choice aims
// with the mouse; the old key (where many had it off) no longer counts; turning it off again is kept.
beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

test('sin nada guardado se apunta con el ratón', () => {
  expect(manualAim()).toBe(true);
});

test('lo que se guardó con la clave de antes ya no cuenta: vuelve a estar activado', () => {
  localStorage.setItem('galaxy.aim.manual', '0');
  expect(manualAim()).toBe(true);
});

test('quien lo apaga después lo tiene apagado', () => {
  setManualAim(false);
  expect(manualAim()).toBe(false);
  setManualAim(true);
  expect(manualAim()).toBe(true);
});
