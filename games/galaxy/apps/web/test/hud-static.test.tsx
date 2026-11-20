import { createSim, DEFAULT_CONTENT, hudSnapshot, type HudSnapshot } from '@galaxy/sim';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Hud } from '../src/arena/hud/Hud';
import { copy } from '../src/copy/es';

// «La Estática te alcanza» in the HUD (2026-11-16): the warning with its seconds left, then the harm with the healing
// blocked, and the life bar marked while it lasts.

const base = (): HudSnapshot => hudSnapshot(createSim({ seed: '5', content: DEFAULT_CONTENT, sector: 'outer-nebula', probes: [{ probe: 'lumen', relics: [] }] }), 0);
const show = (still: Partial<HudSnapshot['still']>) => {
  const hud = base();
  render(<Hud hud={{ ...hud, still: { ...hud.still, ...still } }} content={DEFAULT_CONTENT} announce="" />);
};
const t = copy.arena.still;

test('sin quedarse quieto no dice nada', () => {
  show({ level: 0 });
  expect(screen.queryByRole('status', { name: t.title })).toBeNull();
});

test('avisa con los segundos que faltan', () => {
  show({ level: 1, left: 2.4 });
  expect(screen.getByRole('status', { name: t.title })).toHaveTextContent(t.warn(3));
});

test('mientras hace daño dice que no hay curación y marca la barra de vida', () => {
  show({ level: 2 });
  expect(screen.getByRole('status', { name: t.title })).toHaveTextContent(t.hurt);
  expect(screen.getByRole('progressbar', { name: copy.arena.hp }).className).toContain('blocked');
});
