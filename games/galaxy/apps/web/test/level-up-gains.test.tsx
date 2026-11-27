import { DEFAULT_CONTENT, type HudSnapshot, type Offer } from '@galaxy/sim';
import { render, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { LevelUp } from '../src/arena/hud/LevelUp';
import { CoopCards } from '../src/coop/CoopHud';
import { withCrumbs } from '../src/ui/crumbs';
import { KeyCapLabel } from '../src/ui/KeyCap';

// What a level-up gives, on the cards (design C, the owner's pick, 2026-11-27): each number before and after with an
// arrow icon between, the new value in green; an evolution's trait first. In solo and in group runs. And no arrow is
// ever text anywhere: the arrow keys and the places in the menus draw icons too.

const S = ' ';
const TEXT_ARROWS = /[→←↑↓›‹➜]|->/;
const offer: Offer[] = [
  { kind: 'weapon', id: 'pulse', level: 2 },
  { kind: 'evolve', id: 'pulse-storm', level: 1 },
  { kind: 'passive', id: 'armor', level: 1 },
];

test('en solitario, cada carta dice qué da su nivel, antes y después, con un icono entre los valores', () => {
  render(<LevelUp offer={offer} content={DEFAULT_CONTENT} onPick={() => {}} />);
  const cards = screen.getAllByRole('radio');
  // Pulso láser 1 → 2: damage and cooldown, said whole for screen readers.
  const pulse = cards[0]!;
  const rows = pulse.querySelectorAll('.gain-rows li');
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent('Daño');
  expect(rows[0]!.querySelector('.gain-from')).toHaveTextContent('10');
  expect(rows[0]!.querySelector('.gain-to')).toHaveTextContent('12');
  expect(rows[0]!.querySelector('svg.gain-arrow')).not.toBeNull();
  expect(pulse).toHaveAccessibleName(expect.stringContaining(`+20${S}% de daño`));
  // The evolution's trait leads.
  expect(cards[1]!.querySelector('.gain-rows li')).toHaveClass('gain-trait');
  // A passive's first level: only what you get, no arrow.
  expect(cards[2]!.querySelector('.gain-arrow')).toBeNull();
  expect(cards[2]!.querySelector('.gain-to')!.textContent).toBe(`+15${S}%`);
  for (const c of cards) expect(c.textContent).not.toMatch(TEXT_ARROWS);
});

test('en grupo, la tira enseña todos los cambios de cada carta y la descripción solo en las nuevas', () => {
  const longest: Offer[] = [
    { kind: 'evolve', id: 'solar-breath', level: 1 },
    { kind: 'weapon', id: 'field', level: 5 },
    { kind: 'weapon', id: 'beam', level: 1 },
  ];
  const hud = { offer: longest, coop: { offerSeq: 3, pickLeft: 7 } } as unknown as HudSnapshot;
  render(<CoopCards hud={hud} content={DEFAULT_CONTENT} pickSeconds={15} onPick={() => {}} />);
  const strip = screen.getByRole('region');
  const cards = within(strip).getAllByRole('button');
  // Every change shows, none clamped away: Aliento solar's trait and its six numbers, Pozo gravitatorio's five.
  expect(cards[0]!.querySelectorAll('.gain-rows li').length).toBe(7);
  expect(cards[1]!.querySelectorAll('.gain-rows li').length).toBe(5);
  // A level-up keeps its description for screen readers and the tooltip; a new card shows it.
  expect(cards[1]!.querySelector('.coop-card-desc')).toBeNull();
  expect(cards[1]).toHaveAttribute('title');
  expect(cards[2]!.querySelector('.coop-card-desc')).not.toBeNull();
  for (const c of cards) expect(c.textContent).not.toMatch(TEXT_ARROWS);
});

test('las flechas del teclado se dibujan con iconos en su tecla, nunca como texto', () => {
  for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
    const { container, unmount } = render(<KeyCapLabel code={code} />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.textContent).not.toMatch(TEXT_ARROWS);
    unmount();
  }
  const { container } = render(<KeyCapLabel code="KeyW" />);
  expect(container).toHaveTextContent('W');
});

test('un lugar de los menús («Ajustes › Incursión») lleva un icono en vez de la flecha de texto', () => {
  const { container } = render(<p>{withCrumbs('En Ajustes › Incursión cambias tus teclas')}</p>);
  expect(container.querySelector('svg.crumb-arrow')).not.toBeNull();
  expect(container.textContent).toBe('En Ajustes, Incursión cambias tus teclas');
});
