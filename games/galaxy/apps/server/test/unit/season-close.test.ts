import { parseConfig } from '@galaxy/shared';
import { describe, expect, test } from 'vitest';
import { closingMail, podiumOf, rewardsFor } from '../../src/season/close';

// Closing a season (plan «temporadas como fichas», PR 2): the podium skips who cannot win prizes for their place (they
// keep their rank), and each ranked player's message says where they finished.

const rows = (ids: string[]) => ids.map((accountId, i) => ({ accountId, rank: i + 1 }));

describe('el podio', () => {
  test('son los primeros puestos', () => {
    expect([...podiumOf(rows(['a', 'b', 'c', 'd']), 3, new Set())]).toEqual(['a', 'b', 'c']);
  });

  test('quien no puede ganar premios por puesto se salta y el siguiente entra', () => {
    expect([...podiumOf(rows(['admin', 'b', 'c', 'd']), 3, new Set(['admin']))]).toEqual(['b', 'c', 'd']);
  });

  test('con menos jugadores que puestos, todos los que pueden', () => {
    expect([...podiumOf(rows(['a']), 3, new Set())]).toEqual(['a']);
    expect([...podiumOf(rows(['a', 'b']), 0, new Set())]).toEqual([]);
  });
});

test('el premio del podio solo va a quien está en él; el del tramo, a todos', () => {
  const closing = parseConfig('seasonRoute', {}).closing;
  expect(rewardsFor(true, 'gold', closing)).toEqual([closing.tiers[2], closing.podium]);
  expect(rewardsFor(false, 'gold', closing)).toEqual([closing.tiers[2]]);
  expect(rewardsFor(false, null, closing)).toEqual([]);
});

test('el aviso de cierre dice el puesto, el tramo y los puntos, y si hay premios que recoger', () => {
  expect(closingMail('Temporada 1', 4, 12500, 'gold', true)).toEqual({ title: 'Temporada 1 ha terminado', body: 'Quedaste 4.º en el tramo Oro, con 12.500 puntos. Tus premios te esperan en Temporada' });
  expect(closingMail('Temporada 1', 30, 90, null, false)).toEqual({ title: 'Temporada 1 ha terminado', body: 'Quedaste 30.º con 90 puntos' });
});
