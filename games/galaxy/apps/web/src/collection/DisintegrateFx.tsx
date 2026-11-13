import type { PulledGalaxy } from '@galaxy/shared';
import { type CSSProperties, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { getSettings, sfxOut } from '../audio/mixer';
import { noise, tone } from '../audio/synth';
import { GalaxyCard } from '../cards/GalaxyCard';
import { Icon } from '../ui/Icon';
import { chipsFor } from '../shop/PurchaseFx';

// Disintegrating (the owner: «desintegrar galaxias no tiene ninguna animación»): the galaxies come forward, glow in
// their rarity's colour and come apart from the bottom up into motes, and the dust flies into the wallet, which then
// counts up (WalletBar). With reduced motion they fade and one soft chime sounds. It never blocks the screen: it ends
// by itself.

/** How many cards come forward at most (the rest are told by a count). */
const SHOWN = 7;
const MOTES = 16;
const CARD_MS = 1100;
const STAGGER_MS = 90;
const FLIGHT_MS = 900;

function playDissolve(cards: number, reduced: boolean): void {
  const bus = sfxOut();
  if (!bus || getSettings().muted) return;
  const { ctx, out } = bus;
  const t = ctx.currentTime;
  if (reduced) {
    tone(ctx, out, t, 880, 660, 0.5, 0.035, 'sine');
    return;
  }
  // Each card crackles as it comes apart (a falling hiss and a high sparkle), then the dust lands rising.
  for (let i = 0; i < cards; i++) {
    const at = t + 0.35 + (i * STAGGER_MS) / 1000;
    noise(ctx, out, at, 0.45, 0.07, 3200);
    tone(ctx, out, at, 1760, 520, 0.4, 0.018, 'triangle');
  }
  const land = t + 0.35 + (cards * STAGGER_MS) / 1000 + 0.55;
  for (let i = 0; i < 6; i++) tone(ctx, out, land + i * 0.06, 1319 * 2 ** (i / 12), 1319 * 2 ** (i / 12), 0.08, 0.02, 'sine');
}

export function DisintegrateFx({ galaxies, dust, reduced, onDone }: { galaxies: readonly PulledGalaxy[]; dust: number; reduced: boolean; onDone: () => void }) {
  const shown = galaxies.slice(0, SHOWN);
  const more = galaxies.length - shown.length;
  const total = reduced ? 600 : 350 + shown.length * STAGGER_MS + CARD_MS + FLIGHT_MS + 250;

  useEffect(() => {
    playDissolve(shown.length, reduced);
    const id = setTimeout(onDone, total);
    return () => clearTimeout(id);
    // One animation per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The dust chips: from the middle of the cards to the wallet's dust, after the cards have come apart.
  const chips = useMemo(() => {
    if (reduced || typeof document === 'undefined') return [];
    const to = document.querySelector('.res.dust')?.getBoundingClientRect();
    const x = window.innerWidth / 2;
    const y = window.innerHeight * 0.48;
    const tx = to ? to.left + 14 : window.innerWidth - 80;
    const ty = to ? to.top + to.height / 2 : 40;
    const n = chipsFor(dust);
    const start = 350 + shown.length * STAGGER_MS + CARD_MS * 0.6;
    return Array.from({ length: n }, (_, i) => {
      const spread = (i - n / 2) * 11;
      return { id: i, x: x + spread, y: y + ((i * 41) % 50) - 25, dx: tx - x - spread, dy: ty - y, delay: start + i * 50 };
    });
  }, [dust, reduced, shown.length]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className={`dissolve-fx${reduced ? ' reduced' : ''}`} aria-hidden="true">
      <div className="dissolve-row">
        {shown.map((g, i) => (
          <div key={g.id} className="dissolve-slot" data-tier={g.tier} style={{ '--i': i } as CSSProperties}>
            <div className="dissolve-card">
              <GalaxyCard galaxy={g} size={140} />
            </div>
            {reduced ? null : <span className="dissolve-edge" />}
            {reduced
              ? null
              : Array.from({ length: MOTES }, (_, k) => {
                  // Each mote leaves from the height the edge has reached when it goes (the card comes apart from the bottom up).
                  const at = (k * 47) % 560;
                  return (
                    <i
                      key={k}
                      className="dissolve-mote"
                      style={{ left: `${6 + ((k * 37) % 88)}%`, bottom: `${Math.round((at / 560) * 92)}%`, '--dx': `${((k * 53) % 110) - 55}px`, '--dy': `${-50 - ((k * 31) % 90)}px`, '--d': `${350 + i * STAGGER_MS + 495 + at}ms` } as CSSProperties}
                    />
                  );
                })}
          </div>
        ))}
        {more > 0 ? <span className="dissolve-more">+{more}</span> : null}
      </div>
      {chips.length > 0 ? (
        <div className="claim-fx">
          {chips.map((c) => (
            <span key={c.id} className="claim-chip dust" style={{ left: `${c.x}px`, top: `${c.y}px`, '--dx': `${c.dx}px`, '--dy': `${c.dy}px`, animationDelay: `${c.delay}ms` } as CSSProperties}>
              <Icon name="dust" />
            </span>
          ))}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
