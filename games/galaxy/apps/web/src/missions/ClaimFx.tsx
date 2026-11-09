import { type CSSProperties, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '../ui/Icon';
import type { Reward } from './ready';

// The reward flying to the wallet (open beta): from the «Recoger» pressed, a few chips of each currency it gives arc
// up to that currency in the wallet, one after another; the wallet then counts up. Nothing with reduced motion.

type Kind = 'coins' | 'dust' | 'signal';
type Chip = { id: number; kind: Kind; x: number; y: number; dx: number; dy: number; delay: number };

const ICON: Record<Kind, IconName> = { coins: 'coin', dust: 'dust', signal: 'ticket' };
const FLIGHT_MS = 900;
let next = 0;

export function useClaimFx(reduced: boolean) {
  const [chips, setChips] = useState<Chip[]>([]);
  const burst = useCallback(
    (from: Element | null, reward: Reward) => {
      if (reduced || !from || typeof document === 'undefined') return;
      const a = from.getBoundingClientRect();
      const x = a.left + a.width / 2;
      const y = a.top + a.height / 2;
      const kinds: Kind[] = [];
      if ((reward.coins ?? 0) > 0) kinds.push('coins');
      if ((reward.dust ?? 0) > 0) kinds.push('dust');
      if ((reward.signal ?? 0) + (reward.eventSignals ?? 0) > 0) kinds.push('signal');
      const made: Chip[] = [];
      kinds.forEach((kind, k) => {
        const to = document.querySelector(`.missions-wallet .res.${kind}`)?.getBoundingClientRect();
        const tx = to ? to.left + 14 : window.innerWidth - 80;
        const ty = to ? to.top + to.height / 2 : 40;
        for (let i = 0; i < 4; i++) {
          made.push({ id: ++next, kind, x: x + (i - 1.5) * 10, y, dx: tx - x - (i - 1.5) * 10, dy: ty - y, delay: k * 120 + i * 70 });
        }
      });
      if (made.length === 0) return;
      setChips((c) => [...c, ...made]);
      const ids = new Set(made.map((c) => c.id));
      setTimeout(() => setChips((c) => c.filter((x) => !ids.has(x.id))), FLIGHT_MS + 600);
    },
    [reduced],
  );
  const view =
    chips.length > 0 && typeof document !== 'undefined'
      ? createPortal(
          <div className="claim-fx" aria-hidden="true">
            {chips.map((c) => (
              <span
                key={c.id}
                className={`claim-chip ${c.kind}`}
                style={{ left: `${c.x}px`, top: `${c.y}px`, '--dx': `${c.dx}px`, '--dy': `${c.dy}px`, animationDelay: `${c.delay}ms` } as CSSProperties}
              >
                <Icon name={ICON[c.kind]} />
              </span>
            ))}
          </div>,
          document.body,
        )
      : null;
  return { burst, view };
}
