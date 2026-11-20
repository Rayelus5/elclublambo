import { TIERS, type PulledGalaxy } from '@galaxy/shared';
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef } from 'react';
import { GalaxyCard } from '../cards/GalaxyCard';
import { copy } from '../copy/es';
import { sfx } from './sfx';

// The end of a scan (GDD §9), the same after the classic reveal and the pro one (plan «escáner pro», part B): every
// galaxy found, rarest first, landing one after another with a ping, then «¡Escanear otra!», «Colección» and «Cerrar».
// The focus lands on «Cerrar» (the button that had it — Saltar — is gone by then).

export function RevealSummary({
  pulls,
  status,
  actions,
  onClose,
  reduced,
  className = 'stage-summary',
}: {
  pulls: readonly PulledGalaxy[];
  status?: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  reduced: boolean;
  className?: string;
}) {
  const sorted = useMemo(() => [...pulls].sort((a, b) => TIERS.indexOf(b.tier) - TIERS.indexOf(a.tier)), [pulls]);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeButton.current?.focus();
  }, []);
  // The cards land one after another, the rarest first, each with its ping.
  useEffect(() => {
    if (reduced) return;
    const timers = pulls.map((_, i) => setTimeout(() => sfx.ping(i), 120 + i * 90));
    return () => timers.forEach(clearTimeout);
  }, [reduced, pulls]);
  // A single scan's card leaves room for the line and buttons under it on a 720 px screen.
  const soloSize = Math.min(280, Math.round((globalThis.innerHeight || 800) * 0.36));
  return (
    <div className={className}>
      <h3>{copy.scanner.summaryTitle(pulls.length)}</h3>
      <div className="summary-cards" data-count={pulls.length}>
        {sorted.map((g, i) => (
          <div key={g.id} className={`summary-card${i === 0 && pulls.length > 1 ? ' best' : ''}`} data-tier={g.tier} style={{ '--i': i } as CSSProperties}>
            <GalaxyCard galaxy={g} size={pulls.length > 1 ? 168 : soloSize} interactive />
          </div>
        ))}
      </div>
      {status}
      <div className="summary-actions">
        {actions}
        <button ref={closeButton} type="button" className="lip pill" onClick={onClose}>
          {copy.scanner.close}
        </button>
      </div>
    </div>
  );
}
