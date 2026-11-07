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

test('sin material no lo enseña', () => {
  show({ ...died, payout: { ...died.payout, material: 0 } });
  expect(screen.queryByRole('img', { name: copy.results.material(0) })).toBeNull();
});
