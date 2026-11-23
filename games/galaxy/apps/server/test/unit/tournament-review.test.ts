import { type Role, tournamentRecordSchema } from '@galaxy/shared';
import { describe, expect, test } from 'vitest';
import { joinBlock } from '../../src/tournaments/player';
import type { TournamentRow } from '../../src/tournaments/records';
import { checkBlock, resultsMail, runsToCheck, scoreWords } from '../../src/tournaments/review';

// The review and the sign-up's rules (plan «temporadas como fichas», part 5; GDD §13.3): which runs a prize place rests
// on, what each winner's mail says, and why someone cannot sign up.

const run = (id: string, accountId: string, value: number, at: string, coop = false) => ({ id, accountId, coop, finishedAt: `2026-12-05T${at}:00.000Z`, value });

describe('qué partidas se comprueban', () => {
  const runs = [run('a1', 'a', 30, '10:00'), run('a2', 'a', 50, '11:00'), run('a3', 'a', 50, '12:00'), run('a4', 'a', 0, '13:00'), run('b1', 'b', 70, '10:00', true), run('b2', 'b', 10, '11:00')];

  test('en las sumas, todas las que sumaron algo y no son de grupo', () => {
    expect(runsToCheck('points', runs)).toEqual(['a1', 'a2', 'a3', 'b2']);
  });

  test('en la mejor partida y en la capa, solo la que dio la mejor (la primera en llegar); si es de grupo, ninguna', () => {
    expect(runsToCheck('best_run', runs)).toEqual(['a2']);
    expect(runsToCheck('depth', runs)).toEqual(['a2']);
  });
});

describe('quién decide una partida que no se pudo comprobar', () => {
  const me = (...roles: Role[]) => ({ accountId: 'yo', roles });

  test('tu propia partida solo la puedes descartar: aceptarla lo decide otro', () => {
    expect(checkBlock(me('superadmin'), 'yo', ['superadmin'], 'accept')).toBe('tournament_self_accept');
    expect(checkBlock(me('admin'), 'yo', ['admin'], 'accept')).toBe('tournament_self_accept');
    expect(checkBlock(me('superadmin'), 'yo', ['superadmin'], 'discard')).toBeNull();
    expect(checkBlock(me('admin'), 'yo', ['admin'], 'discard')).toBeNull();
  });

  test('la de un superadmin la decide otro superadmin, nunca un admin', () => {
    expect(checkBlock(me('superadmin'), 'otro', ['superadmin'], 'accept')).toBeNull();
    expect(checkBlock(me('superadmin'), 'otro', ['superadmin'], 'discard')).toBeNull();
    expect(checkBlock(me('admin'), 'otro', ['superadmin'], 'accept')).toBe('staff_target');
    expect(checkBlock(me('admin'), 'otro', ['superadmin'], 'discard')).toBe('staff_target');
  });

  test('la de otro del equipo solo la decide un superadmin', () => {
    expect(checkBlock(me('admin'), 'otro', ['admin'], 'accept')).toBe('staff_target');
    expect(checkBlock(me('admin'), 'otro', ['moderator'], 'discard')).toBe('staff_target');
    expect(checkBlock(me('superadmin'), 'otro', ['admin'], 'accept')).toBeNull();
  });

  test('la de un jugador la decide cualquier admin', () => {
    expect(checkBlock(me('admin'), 'jugador', [], 'accept')).toBeNull();
    expect(checkBlock(me('admin'), 'jugador', [], 'discard')).toBeNull();
    expect(checkBlock(me('superadmin'), 'jugador', [], 'accept')).toBeNull();
  });
});

describe('el aviso de los resultados', () => {
  test('dice el puesto con la medida en palabras y dónde se recogen los premios', () => {
    expect(resultsMail('Copa de invierno', 'points', { rank: 2, score: 12500, runs: 9, rewards: { place: 2, gifts: [{ kind: 'currency', currency: 'coins', amount: 1 }], cash: null, participation: false } })).toEqual({
      title: 'Copa de invierno ha terminado',
      body: 'Quedaste 2.º con 12.500 puntos. Tus premios te esperan en la página del torneo',
    });
  });

  test('el dinero lo paga un admin aparte, y la participación sola dice las partidas', () => {
    expect(resultsMail('Copa', 'depth', { rank: 1, score: 9, runs: 3, rewards: { place: 1, gifts: [], cash: { amountEur: 20, note: '' }, participation: false } }).body).toBe(
      'Quedaste 1.º llegando a la capa 9. Un admin te escribirá por el buzón para el premio en metálico',
    );
    expect(resultsMail('Copa', 'kills', { rank: 40, score: 1, runs: 1, rewards: { place: null, gifts: [{ kind: 'xp', amount: 5 }], cash: null, participation: true } }).body).toBe(
      'Jugaste 1 partida en el torneo. Tu premio de participación te espera en la página del torneo',
    );
  });

  test('si el premio deja elegir skins, dice que se eligen en la página del torneo', () => {
    const options = ['skin-lumen-navidad', 'skin-bastion-navidad', 'skin-spark-navidad'];
    const choice = (count: number) => ({ piece: 'skin' as const, options, count, perMissing: { currency: 'signal' as const, amount: 10 } });
    expect(resultsMail('Torneo Navideño', 'points', { rank: 2, score: 900, runs: 30, rewards: { place: 2, gifts: [{ kind: 'currency', currency: 'signal', amount: 25 }], cash: null, participation: false, choice: choice(1) } }).body).toBe(
      'Quedaste 2.º con 900 puntos. Tus premios te esperan en la página del torneo. Entra en la página del torneo para elegir tus skins',
    );
    // Only skins to choose, no gifts: still a prize to collect.
    expect(resultsMail('Torneo Navideño', 'points', { rank: 3, score: 500, runs: 12, rewards: { place: 3, gifts: [], cash: null, participation: false, choice: choice(2) } }).body).toBe(
      'Quedaste 3.º con 500 puntos. Tus premios te esperan en la página del torneo. Entra en la página del torneo para elegir tus skins',
    );
    // Every option given on its own (the whole pack): nothing to choose.
    expect(resultsMail('Torneo Navideño', 'points', { rank: 1, score: 15000, runs: 40, rewards: { place: 1, gifts: [], cash: null, participation: false, choice: choice(3) } }).body).toBe(
      'Quedaste 1.º con 15.000 puntos. Tus premios te esperan en la página del torneo',
    );
  });

  test('cada medida en palabras, en singular y en plural', () => {
    expect(scoreWords('kills', 1)).toBe('con 1 baja');
    expect(scoreWords('cores', 3)).toBe('con 3 Núcleos');
    expect(scoreWords('extractions', 2)).toBe('con 2 extracciones');
    expect(scoreWords('best_run', 12000)).toBe('con una partida de 12.000 puntos');
    expect(scoreWords('runs', 4)).toBe('con 4 partidas');
  });
});

describe('por qué no te puedes inscribir', () => {
  const now = new Date('2026-12-05T12:00:00.000Z');
  const row = (over: Partial<TournamentRow> = {}, record: object = {}): TournamentRow => ({
    id: 't1',
    state: 'running',
    version: 2,
    record: tournamentRecordSchema.parse({ slug: 'copa', seasonId: 's2', title: 'Copa', startsAt: '2026-12-04T00:00:00.000Z', endsAt: '2026-12-07T00:00:00.000Z', metric: 'points', ...record }),
    createdAt: '',
    createdBy: null,
    updatedAt: '',
    updatedBy: null,
    scheduledAt: null,
    scheduledBy: null,
    publishedAt: null,
    cancelledAt: null,
    startedSimVersion: null,
    ...over,
  });
  const entry = (over: object = {}) => ({ tournament_id: 't1', joined_at: now, left_at: null, refunded_at: null, disqualified: false, disqualified_reason: null, final_rank: null, final_score: null, final_runs: null, rewards: null, eligible: null, claimed_at: null, ...over });
  const v = { entry: undefined, level: 10, entrants: 3, clash: null, excluded: false };

  test('abierto mientras está programado o en curso y antes de su fin', () => {
    expect(joinBlock(row(), v, now)).toBeNull();
    expect(joinBlock(row({ state: 'scheduled' }), v, now)).toBeNull();
    expect(joinBlock(row({ state: 'review' }), v, now)).toBe('closed');
    expect(joinBlock(row(), v, new Date('2026-12-07T00:00:00.000Z'))).toBe('closed');
  });

  test('quien está, salió o fue descalificado no vuelve a entrar', () => {
    expect(joinBlock(row(), { ...v, entry: entry() }, now)).toBe('joined');
    expect(joinBlock(row(), { ...v, entry: entry({ left_at: now }) }, now)).toBe('left');
    expect(joinBlock(row(), { ...v, entry: entry({ disqualified: true }) }, now)).toBe('disqualified');
  });

  test('el cupo, el nivel y otro exclusivo que se solapa', () => {
    expect(joinBlock(row({}, { maxEntrants: 3 }), v, now)).toBe('full');
    expect(joinBlock(row({}, { filters: { minLevel: 11 } }), v, now)).toBe('level');
    expect(joinBlock(row(), { ...v, clash: { slug: 'otra', title: 'Otra' } }, now)).toBe('exclusive');
  });

  test('quien está fuera de la clasificación no puede inscribirse (nunca tendría puesto)', () => {
    expect(joinBlock(row(), { ...v, excluded: true }, now)).toBe('excluded');
  });
});
