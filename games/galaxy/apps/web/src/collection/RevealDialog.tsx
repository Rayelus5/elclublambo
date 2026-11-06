import type { PulledGalaxy } from '@galaxy/shared';
import { GalaxyCard } from '../cards/GalaxyCard';
import { copy } from '../copy/es';
import { Dialog } from '../ui/Dialog';

/** A new galaxy shown to the player (a fusion's result). The Scanner's full reveal takes over this moment in Task 10. */
export function RevealDialog({ galaxies, onClose }: { galaxies: PulledGalaxy[]; onClose: () => void }) {
  return (
    <Dialog title={copy.collection.revealTitle} onClose={onClose} className="reveal">
      <div className="reveal-cards">
        {galaxies.map((g) => (
          <GalaxyCard key={g.id} galaxy={g} size={280} interactive />
        ))}
      </div>
      <button type="button" className="lip pill pill-solar" data-autofocus onClick={onClose}>
        {copy.collection.revealDone}
      </button>
    </Dialog>
  );
}
