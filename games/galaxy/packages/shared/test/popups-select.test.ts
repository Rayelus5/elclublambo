import { describe, expect, test } from 'vitest';
import { type MailAudience, nextPopup, POPUP_MAX_SHOWS, type PopupCandidate, type PopupViewState } from '../src';

// «Encuestas y avisos» (GDD §16.5): which popup, if any, a player sees when they open the game. Only campaigns live now
// whose audience they are in (newcomers too, unless the admin set join dates), not answered, shown fewer than three
// times, never twice in the same Madrid day, and at most one popup a day over every campaign: the highest priority,
// then the newest, then by id.

const NOW = new Date('2026-11-22T12:00:00.000Z');
const TODAY = '2026-11-22';
const vega = { level: 12, createdAt: new Date('2026-11-01T08:00:00.000Z'), username: 'vega' };

let n = 0;
function campaign(extra: Partial<PopupCandidate> = {}): PopupCandidate {
  n += 1;
  return {
    id: `c${n}`,
    state: 'published',
    startsAt: '2026-11-20T10:00:00.000Z',
    endsAt: '2026-11-30T10:00:00.000Z',
    endedAt: null,
    priority: 1,
    audience: { kind: 'all' },
    ...extra,
  };
}
const view = (campaignId: string, extra: Partial<PopupViewState> = {}): PopupViewState => ({ campaignId, shows: 1, lastShownDay: '2026-11-21', done: false, ...extra });

describe('qué campaña ve un jugador al abrir el juego', () => {
  test('sin campañas, ninguna', () => {
    expect(nextPopup([], [], vega, NOW, TODAY)).toBeNull();
  });

  test('una campaña en curso para todos la ve también quien acaba de llegar', () => {
    const c = campaign();
    expect(nextPopup([c], [], vega, NOW, TODAY)).toBe(c.id);
    const newcomer = { ...vega, createdAt: new Date('2026-11-22T11:59:00.000Z') };
    expect(nextPopup([c], [], newcomer, NOW, TODAY)).toBe(c.id);
  });

  test('los borradores, las programadas y las terminadas no salen', () => {
    expect(nextPopup([campaign({ state: 'draft' })], [], vega, NOW, TODAY)).toBeNull();
    expect(nextPopup([campaign({ startsAt: '2026-11-22T12:00:00.001Z' })], [], vega, NOW, TODAY)).toBeNull();
    expect(nextPopup([campaign({ endsAt: NOW.toISOString() })], [], vega, NOW, TODAY)).toBeNull();
    expect(nextPopup([campaign({ endedAt: '2026-11-22T11:00:00.000Z' })], [], vega, NOW, TODAY)).toBeNull();
  });

  test('los segmentos: fechas de alta, nivel y nombres', () => {
    const joined: MailAudience = { kind: 'segment', joinedFrom: '2026-11-01', joinedTo: '2026-11-10' };
    expect(nextPopup([campaign({ audience: joined })], [], vega, NOW, TODAY)).not.toBeNull();
    // With join dates, a newcomer after them is out.
    expect(nextPopup([campaign({ audience: joined })], [], { ...vega, createdAt: new Date('2026-11-22T08:00:00.000Z') }, NOW, TODAY)).toBeNull();
    expect(nextPopup([campaign({ audience: { kind: 'segment', minLevel: 13 } })], [], vega, NOW, TODAY)).toBeNull();
    expect(nextPopup([campaign({ audience: { kind: 'segment', minLevel: 10, maxLevel: 12 } })], [], vega, NOW, TODAY)).not.toBeNull();
    expect(nextPopup([campaign({ audience: { kind: 'segment', usernames: ['nova'] } })], [], vega, NOW, TODAY)).toBeNull();
    expect(nextPopup([campaign({ audience: { kind: 'segment', usernames: ['nova', 'vega'] } })], [], { ...vega, username: 'Vega' }, NOW, TODAY)).not.toBeNull();
  });

  test('la que ya contestó o cerró no vuelve', () => {
    const c = campaign();
    expect(nextPopup([c], [view(c.id, { done: true })], vega, NOW, TODAY)).toBeNull();
  });

  test('tres veces como mucho y después nunca', () => {
    const c = campaign();
    expect(nextPopup([c], [view(c.id, { shows: POPUP_MAX_SHOWS - 1 })], vega, NOW, TODAY)).toBe(c.id);
    expect(nextPopup([c], [view(c.id, { shows: POPUP_MAX_SHOWS })], vega, NOW, TODAY)).toBeNull();
    expect(nextPopup([c], [view(c.id, { shows: POPUP_MAX_SHOWS, lastShownDay: '2026-11-01' })], vega, NOW, '2026-11-25')).toBeNull();
  });

  test('nunca dos veces el mismo día de Madrid', () => {
    const c = campaign();
    expect(nextPopup([c], [view(c.id, { lastShownDay: TODAY })], vega, NOW, TODAY)).toBeNull();
    expect(nextPopup([c], [view(c.id, { lastShownDay: TODAY })], vega, new Date('2026-11-22T23:30:00.000Z'), '2026-11-23')).toBe(c.id);
  });

  test('una al día como mucho entre todas las campañas', () => {
    const a = campaign();
    const b = campaign();
    expect(nextPopup([a, b], [view(a.id, { lastShownDay: TODAY })], vega, NOW, TODAY)).toBeNull();
    // Even when the one seen today is answered or over.
    expect(nextPopup([b], [view(a.id, { lastShownDay: TODAY, done: true })], vega, NOW, TODAY)).toBeNull();
    expect(nextPopup([a, b], [view(a.id, { lastShownDay: '2026-11-21' })], vega, NOW, TODAY)).not.toBeNull();
  });

  test('las reglas se pueden cambiar', () => {
    const a = campaign();
    const b = campaign();
    expect(nextPopup([a, b], [view(a.id, { lastShownDay: TODAY })], vega, NOW, TODAY, { maxShows: 3, perDay: 2 })).toBe(b.id);
    expect(nextPopup([a], [view(a.id, { shows: 3 })], vega, NOW, TODAY, { maxShows: 5, perDay: 1 })).toBe(a.id);
  });

  test('gana la de más prioridad, después la más reciente y después por id', () => {
    const low = campaign({ id: 'a', priority: 0, startsAt: '2026-11-22T11:00:00.000Z' });
    const high = campaign({ id: 'b', priority: 2, startsAt: '2026-11-20T10:00:00.000Z' });
    const normalOld = campaign({ id: 'c', priority: 1, startsAt: '2026-11-20T10:00:00.000Z' });
    const normalNew = campaign({ id: 'd', priority: 1, startsAt: '2026-11-21T10:00:00.000Z' });
    expect(nextPopup([low, normalOld, high, normalNew], [], vega, NOW, TODAY)).toBe('b');
    expect(nextPopup([low, normalOld, normalNew], [], vega, NOW, TODAY)).toBe('d');
    const twinA = campaign({ id: 'x', startsAt: normalNew.startsAt });
    const twinB = campaign({ id: 'w', startsAt: normalNew.startsAt });
    expect(nextPopup([twinA, twinB], [], vega, NOW, TODAY)).toBe('w');
  });

  test('si la mejor ya no puede salir, sale la siguiente', () => {
    const high = campaign({ id: 'h', priority: 2 });
    const normal = campaign({ id: 'n', priority: 1 });
    expect(nextPopup([high, normal], [view('h', { done: true })], vega, NOW, TODAY)).toBe('n');
    expect(nextPopup([high, normal], [view('h', { shows: 3 })], vega, NOW, TODAY)).toBe('n');
  });
});
