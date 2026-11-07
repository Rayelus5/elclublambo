import type { Content, SimEvent } from '@galaxy/sim';
import { copy } from '../copy/es';

// What the run screen reads aloud from a step's events (DESIGN_SYSTEM §8 quinquies): an evolution, and the first time
// each reaction goes off in the run (`seen` remembers them), so the live region never floods.

export function announceFor(events: readonly SimEvent[], content: Content, seen: Set<string>): string | null {
  let out: string | null = null;
  for (const e of events) {
    if (e.t === 'evolve') {
      const name = content.weapons.find((w) => w.id === e.to)?.name;
      if (name) out = copy.arena.announce.evolved(name);
    } else if (e.t === 'reaction' && !seen.has(e.id)) {
      seen.add(e.id);
      const name = content.elements.reactions.find((r) => r.id === e.id)?.name;
      if (name && !out) out = copy.arena.announce.reaction(name);
    }
  }
  return out;
}
