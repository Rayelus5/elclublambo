import type { GalaxySummary } from '@galaxy/shared';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { GalaxyCard } from '../cards/GalaxyCard';
import { copy } from '../copy/es';
import { useReducedMotion } from '../ui/motion';
import { playFusion } from './sfx';

// Galaxies fusing (the owner: «más espectaculares… al mejorar o fusionar»): the chosen cards stand in a ring around
// a swirling core, spin inwards and vanish into it, the core flares white, and the new galaxy is revealed. The
// request runs meanwhile; the reveal waits for both the moment and the answer. «Saltar» goes straight to the reveal
// once the answer is there. Reduced motion: no flight, the reveal as soon as the galaxy arrives.

const PLAY_MS = 1700;

export function FusionSequence({ galaxies, ready, onDone }: { galaxies: GalaxySummary[]; ready: boolean; onDone: () => void }) {
  const reduced = useReducedMotion();
  const [played, setPlayed] = useState(reduced);
  useEffect(() => {
    if (reduced) return;
    playFusion();
    const id = setTimeout(() => setPlayed(true), PLAY_MS);
    return () => clearTimeout(id);
  }, [reduced]);
  const done = useRef(false);
  useEffect(() => {
    if (!played || !ready || done.current) return;
    done.current = true;
    onDone();
  }, [played, ready, onDone]);
  const n = galaxies.length;
  return (
    <div className={`fusion-seq${played ? ' held' : ''}`} role="status" aria-label={copy.collection.fusionLabel}>
      <div className="fusion-stage" aria-hidden="true">
        <span className="fusion-core" />
        <span className="fusion-ring" />
        {galaxies.map((g, i) => {
          const a = (i / n) * Math.PI * 2 - Math.PI / 2;
          return (
            <span key={g.id} className="fusion-card" style={{ '--x': `${Math.cos(a) * 260}px`, '--y': `${Math.sin(a) * 190}px`, '--d': `${i * 60}ms` } as CSSProperties}>
              <GalaxyCard galaxy={g} size={120} />
            </span>
          );
        })}
        <span className="fusion-flash" />
      </div>
      <button type="button" className="lip pill fusion-skip" disabled={!ready} onClick={() => setPlayed(true)}>
        {copy.collection.skipFusion}
      </button>
    </div>
  );
}
