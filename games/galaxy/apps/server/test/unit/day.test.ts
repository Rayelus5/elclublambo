import { expect, test } from 'vitest';
import { madridDay } from '../../src/economy/day';

// The game day ends at 00:00 in Madrid (GDD §11.3 bis), whatever the server's time zone, across both DST changes.
test('el día del juego cambia a medianoche de Madrid, en invierno y en verano', () => {
  // 2026-03-29: CET → CEST at 01:00 UTC.
  expect(madridDay(new Date('2026-03-28T22:59:59Z'))).toBe('2026-03-28');
  expect(madridDay(new Date('2026-03-28T23:00:00Z'))).toBe('2026-03-29');
  expect(madridDay(new Date('2026-03-29T21:59:59Z'))).toBe('2026-03-29');
  expect(madridDay(new Date('2026-03-29T22:00:00Z'))).toBe('2026-03-30');
  // 2026-10-25: CEST → CET at 01:00 UTC.
  expect(madridDay(new Date('2026-10-24T21:59:59Z'))).toBe('2026-10-24');
  expect(madridDay(new Date('2026-10-24T22:00:00Z'))).toBe('2026-10-25');
  expect(madridDay(new Date('2026-10-25T22:59:59Z'))).toBe('2026-10-25');
  expect(madridDay(new Date('2026-10-25T23:00:00Z'))).toBe('2026-10-26');
});
