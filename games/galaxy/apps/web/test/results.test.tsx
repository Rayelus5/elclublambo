import type { RunResult } from '@galaxy/shared';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, test } from 'vitest';
import { copy } from '../src/copy/es';
import { ResultsScreen } from '../src/hangar/ResultsScreen';

// The results of a run (GDD §5.1, §11.3 bis): what was paid, layer by layer, the half without extraction and the
// daily tiers — nothing is cut without saying so.

const died: RunResult = {
  id: 'r1',
  outcome: 'died',
  ticks: 12 * 3600 + 30 * 60,
  depth: 2,
  kills: 1404,
  level: 21,
  payout: { coins: 52, dust: 18, signals: 0, material: 21 },
  breakdown: {
    layers: [
      { layer: 1, coins: 40, dust: 12, multiplier: 1 },
      { layer: 2, coins: 30, dust: 10, multiplier: 1.5 },
    ],
    share: 0.5,
    daily: [
      { seconds: 300, multiplier: 1 },
      { seconds: 450, multiplier: 0.75 },
    ],
  },
  wallet: { coins: 152, dust: 30, signal: 10 },
  progress: { xp: 0, level: 1, levelUp: false, points: 0 },
};

function show(r: RunResult) {
  return render(
    <MemoryRouter>
      <ResultsScreen result={r} onAgain={() => {}} />
    </MemoryRouter>,
  );
}

test('dice cómo acabó, la profundidad, el tiempo, las bajas y el nivel', () => {
  show(died);
  expect(screen.getByRole('heading', { name: copy.results.died })).toBeInTheDocument();
  const stats = within(document.querySelector<HTMLElement>('.results-stats')!);
  expect(stats.getByText(copy.arena.layer(2))).toBeInTheDocument();
  expect(stats.getByText('12:30')).toBeInTheDocument();
  expect(stats.getByText('1404')).toBeInTheDocument();
  expect(stats.getByText(copy.arena.levelShort(21))).toBeInTheDocument();
});

test('el botín de cada capa con su multiplicador, la mitad sin extracción y los tramos del día', () => {
  show(died);
  const rows = screen.getAllByRole('row');
  expect(rows.some((r) => r.textContent?.includes(copy.arena.layer(2)) && r.textContent.includes('×1,5'))).toBe(true);
  expect(screen.getByText(copy.results.half)).toBeInTheDocument();
  expect(screen.getByText(copy.results.daily(5, 1))).toBeInTheDocument();
  expect(screen.getByText(copy.results.daily(7.5, 0.75))).toBeInTheDocument();
  expect(screen.getByRole('img', { name: copy.hub.resource.coins(52) })).toBeInTheDocument();
});

test('ofrece otra incursión y volver al inicio', () => {
  show({ ...died, outcome: 'extracted', breakdown: { ...died.breakdown, share: 1 } });
  expect(screen.getByRole('heading', { name: copy.results.extracted })).toBeInTheDocument();
  expect(screen.queryByText(copy.results.half)).toBeNull();
  expect(screen.getByRole('button', { name: copy.results.again })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: copy.results.home })).toHaveAttribute('href', '/');
});

test('enseña el material en bruto traído para la refinería (M4a)', () => {
  show(died);
  expect(screen.getByRole('img', { name: copy.results.material(21) })).toBeInTheDocument();
});

test('enseña los componentes de los objetos rotos (SIM 1.7.0) y los calla si no hay', () => {
  show({ ...died, payout: { ...died.payout, components: 4 } });
  expect(screen.getByRole('img', { name: copy.results.components(4) })).toBeInTheDocument();
});

test('un resultado sin componentes no los enseña', () => {
  show(died);
  expect(screen.queryByRole('img', { name: /componente/ })).toBeNull();
});

test('sin material no lo enseña', () => {
  show({ ...died, payout: { ...died.payout, material: 0 } });
  expect(screen.queryByRole('img', { name: copy.results.material(0) })).toBeNull();
});

test('dice la experiencia de cuenta, el nivel, si subes y los puntos de temporada (M5a)', () => {
  show({ ...died, progress: { xp: 200, level: 6, levelUp: true, points: 95 } });
  const progress = screen.getByRole('region', { name: copy.social.progressTitle });
  expect(progress).toHaveTextContent('+200 de experiencia');
  expect(progress).toHaveTextContent(copy.social.level(6));
  expect(progress).toHaveTextContent(copy.social.levelUp);
  expect(progress).toHaveTextContent('+95 puntos de temporada');
});

test('sin subir de nivel ni puntos, no los menciona', () => {
  show({ ...died, progress: { xp: 25, level: 2, levelUp: false, points: 0 } });
  const progress = screen.getByRole('region', { name: copy.social.progressTitle });
  expect(progress).not.toHaveTextContent(copy.social.levelUp);
  expect(progress).not.toHaveTextContent('puntos de temporada');
});

test('un resultado guardado antes de M5a, sin progreso, se enseña sin la franja (revisión M5a)', () => {
  const { progress: _progress, ...old } = died;
  show(old as RunResult);
  expect(screen.getByRole('heading', { name: copy.results.died })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: copy.social.progressTitle })).toBeNull();
});
