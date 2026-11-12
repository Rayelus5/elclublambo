import type { Insets } from '../arena/stage/edge';

// The bands of the arena the co-op HUD covers (Nov plan A2 review): the top bar, the team list on the left, the kit
// at the bottom and, while open, the cards' strip. Measured from the DOM a few times a second and handed to the
// stage, so the teammates' arrows never hide under a panel. 8 px of air around each.
const AIR = 8;

type Box = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>;

export function hudInsets(canvas: Box, hud: { top: Box | null; team: Box | null; kit: Box | null; cards: Box | null }): Insets {
  const below = (b: Box | null) => (b ? Math.max(0, b.bottom - canvas.top) + AIR : 0);
  const above = (b: Box | null) => (b ? Math.max(0, canvas.bottom - b.top) + AIR : 0);
  return {
    top: below(hud.top),
    right: 0,
    bottom: Math.max(above(hud.kit), above(hud.cards)),
    left: hud.team ? Math.max(0, hud.team.right - canvas.left) + AIR : 0,
  };
}
