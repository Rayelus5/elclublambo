import { type CoopRunStart, coopRulesOf, coopSimOptions, parseConfig } from '@galaxy/shared';
import { createSim, DEFAULT_CONTENT } from '@galaxy/sim';
import { render, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { TeamResults, teamRows } from '../src/coop/TeamResults';
import { copy } from '../src/copy/es';

// The group run's results by player (multiplayer plan, phase 6c): each one's probe, level, kills, revives, falls and
// how they ended, from the simulation every client shares; the most kills and the most revives are named.

const t = copy.coop.results;
const start: CoopRunStart = {
  id: 'r',
  seed: '424242',
  sector: 'outer-nebula',
  anomaly: null,
  content: DEFAULT_CONTENT,
  contentVersion: 0,
  rules: coopRulesOf(parseConfig('coop', {})),
  players: [
    { username: 'sonda_rayo', probe: 'lumen', relics: [], bonuses: [], variant: null },
    { username: 'vega', probe: 'bastion', relics: [], bonuses: [], variant: null },
    { username: 'lyra', probe: 'lumen', relics: [], bonuses: [], variant: null },
  ],
  slot: 0,
  startedAt: '2026-11-09T10:00:00.000Z',
};

function finished() {
  const sim = createSim(coopSimOptions(start));
  const [a, b, c] = sim.probes;
  Object.assign(a!, { kills: 120, revives: 0, downs: 2, level: 9 });
  Object.assign(b!, { kills: 340, revives: 3, downs: 0, level: 12 });
  Object.assign(c!, { kills: 15, revives: 0, downs: 1, level: 4, life: 'left' });
  return sim;
}

test('una fila por jugador, con su sonda, nivel, eliminaciones, reanimaciones, caídas y cómo acabó', () => {
  const rows = teamRows(finished(), start);
  render(<TeamResults rows={rows} me={0} />);
  const table = screen.getByRole('table', { name: t.title });
  const body = within(table).getAllByRole('row').slice(1);
  expect(body).toHaveLength(3);
  expect(body[0]).toHaveTextContent(copy.coop.arena.you);
  expect(body[1]).toHaveTextContent('vega');
  expect(body[1]).toHaveTextContent('Bastión');
  expect(body[1]).toHaveTextContent('340');
  expect(body[2]).toHaveTextContent(copy.coop.arena.life.left);
});

test('nombra a quien más eliminó y a quien más reanimó; sin reanimaciones no hay premio', () => {
  render(<TeamResults rows={teamRows(finished(), start)} me={0} />);
  const vega = screen.getAllByRole('row').find((r) => r.textContent?.includes('vega'))!;
  expect(vega).toHaveTextContent(t.mostKills);
  expect(vega).toHaveTextContent(t.mostRevives);
  const none = teamRows(finished(), start).map((r) => ({ ...r, revives: 0 }));
  render(<TeamResults rows={none} me={0} />);
  expect(screen.getAllByText(t.mostRevives)).toHaveLength(1);
});

test('ofrece añadir como amigo a cada compañero, nunca en mi fila (plan de noviembre A3)', () => {
  const rows = teamRows(finished(), start);
  render(<TeamResults rows={rows} me={0} befriend={(u) => <button type="button">{`amigo:${u}`}</button>} />);
  const offered = screen.getAllByRole('button', { name: /^amigo:/ }).map((b) => b.textContent);
  expect(offered).toEqual(rows.filter((r) => r.slot !== 0).map((r) => `amigo:${r.name}`));
});
