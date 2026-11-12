import { describe, expect, test } from 'vitest';
import { eventBanner, eventCurrency, eventWarnings, type GameEvent } from '../src';

// What the admin's event screen warns about without blocking (polish phase 4): an event's own signals are only worth
// something with its scanner, and the scanner belongs to its event and its dates.

const event = (id: string, eventSignals = 0): GameEvent => ({
  id,
  name: 'Lluvia de cometas',
  description: 'Una semana de cometas',
  startsAt: '2027-03-01T00:00:00.000Z',
  endsAt: '2027-03-08T00:00:00.000Z',
  goals: [{ id: 'kills', name: 'Elimina 500', stat: 'kills', target: 500, scope: 'personal', reward: { coins: 100, dust: 0, signal: 0, xp: 0, points: 0, eventSignals, title: null, frame: null, avatar: null, skin: null } }],
});
const scanner = (id: string, dates = { startsAt: '2027-03-01T00:00:00.000Z', endsAt: '2027-03-08T00:00:00.000Z' }) => ({
  id,
  kind: 'event' as const,
  name: 'Escáner de cometas',
  pityGroup: `event-${id}`,
  currency: eventCurrency(id),
  ...dates,
});
const standard = { id: 'deep-scan', kind: 'standard' as const, name: 'Escáner profundo', pityGroup: 'standard', currency: 'signal' };

describe('eventWarnings', () => {
  test('un evento con su escáner, en sus fechas y con señales del evento: nada que avisar', () => {
    expect(eventWarnings([event('cometas', 5)], [standard, scanner('cometas')])).toEqual([]);
    expect(eventBanner(event('cometas'), [standard, scanner('cometas')])?.id).toBe('cometas');
  });

  test('señales del evento sin escáner que las gaste', () => {
    expect(eventWarnings([event('cometas', 5)], [standard])).toEqual([{ code: 'signals_without_scanner', event: 'cometas' }]);
  });

  test('un escáner que se paga con señales que ninguna meta da', () => {
    expect(eventWarnings([event('cometas')], [standard, scanner('cometas')])).toEqual([{ code: 'scanner_without_signals', event: 'cometas' }]);
  });

  test('un escáner en otras fechas que su evento', () => {
    const later = scanner('cometas', { startsAt: '2027-03-02T00:00:00.000Z', endsAt: '2027-03-08T00:00:00.000Z' });
    expect(eventWarnings([event('cometas', 5)], [standard, later])).toEqual([{ code: 'scanner_dates', event: 'cometas' }]);
  });

  test('un escáner de evento cuyo evento ya no existe', () => {
    expect(eventWarnings([], [standard, scanner('viejo')])).toEqual([{ code: 'scanner_without_event', banner: 'viejo' }]);
  });
});
