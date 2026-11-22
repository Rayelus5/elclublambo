import { pieceName } from '@galaxy/shared';
import { type CSSProperties, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { copy } from '../copy/es';
import { Icon, type IconName } from '../ui/Icon';
import type { Reward, RewardCard } from './ready';

// The reward flying to the wallet (open beta): from the «Recoger» pressed, a few chips of each currency it gives arc
// up to that currency in the wallet, one after another; the wallet then counts up. Any wallet marked `data-wallet` is
// a target (Missions and the season screen, season shop plan PR 4), the season currency flies as its shard, and a
// piece (title, frame, avatar, skin) has nowhere to fly: it pops where it was collected as a little card with its
// name and fades. A season's gifts of any kind (plan «temporadas como fichas», PR 4) pop the same way: a galaxy in its
// tier's colour, a probe, a resource the wallet does not show. Nothing with reduced motion.

type Kind = 'coins' | 'dust' | 'signal' | 'event-signal' | 'shards';
type Chip = { id: number; kind: Kind; x: number; y: number; dx: number; dy: number; delay: number };
type PieceKind = RewardCard['kind'];
type Piece = { id: number; kind: PieceKind; name: string; tier?: string; x: number; y: number; delay: number };

const ICON: Record<Kind, IconName> = { coins: 'coin', dust: 'dust', signal: 'ticket', 'event-signal': 'ticket', shards: 'shard' };
const PIECE_ICON: Record<PieceKind, IconName> = { title: 'starOn', frame: 'trophy', avatar: 'trophy', skin: 'probe', galaxy: 'comet', probe: 'probe', resource: 'cube' };
/** The cards worth a celebration: a piece, a galaxy, a probe (a resource is not). */
export const BIG_CARDS: ReadonlySet<PieceKind> = new Set(['title', 'frame', 'avatar', 'skin', 'galaxy', 'probe']);
const FLIGHT_MS = 900;
const PIECE_MS = 1800;
const PIECE_GAP_MS = 260;
let next = 0;

/** The pieces a reward gives, each with its name as the player reads it, then its other cards (a season's gifts). */
export function piecesOf(reward: Reward): RewardCard[] {
  const out: RewardCard[] = [];
  if (reward.title) out.push({ kind: 'title', name: reward.title });
  if (reward.frame) out.push({ kind: 'frame', name: pieceName('frame', reward.frame) });
  if (reward.avatar) out.push({ kind: 'avatar', name: pieceName('avatar', reward.avatar) });
  if (reward.skin) out.push({ kind: 'skin', name: pieceName('skin', reward.skin) });
  return [...out, ...(reward.cards ?? [])];
}

/**
 * The flight of what a reward gives: `burst(from, reward)` from an element, or from the box it had (read before the
 * answer replaced it), and `view` rendered anywhere (it portals to the body).
 */
export function useClaimFx(reduced: boolean) {
  const [chips, setChips] = useState<Chip[]>([]);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const burst = useCallback(
    (from: Element | DOMRectReadOnly | null, reward: Reward) => {
      if (reduced || !from || typeof document === 'undefined') return;
      const a = 'getBoundingClientRect' in from ? from.getBoundingClientRect() : from;
      const x = a.left + a.width / 2;
      const y = a.top + a.height / 2;
      const kinds: Kind[] = [];
      if ((reward.coins ?? 0) > 0) kinds.push('coins');
      if ((reward.dust ?? 0) > 0) kinds.push('dust');
      if ((reward.signal ?? 0) > 0) kinds.push('signal');
      // The event's own signals fly to their purple ticket, not to the normal ones.
      if ((reward.eventSignals ?? 0) > 0) kinds.push('event-signal');
      if ((reward.shards ?? 0) > 0) kinds.push('shards');
      const made: Chip[] = [];
      kinds.forEach((kind, k) => {
        const to = document.querySelector(`[data-wallet] .res.${kind}`)?.getBoundingClientRect();
        const tx = to ? to.left + 14 : window.innerWidth - 80;
        const ty = to ? to.top + to.height / 2 : 40;
        for (let i = 0; i < 4; i++) {
          made.push({ id: ++next, kind, x: x + (i - 1.5) * 10, y, dx: tx - x - (i - 1.5) * 10, dy: ty - y, delay: k * 120 + i * 70 });
        }
      });
      // The pieces pop one after another over the button, once the first chips have left it, stacked upwards.
      const popped: Piece[] = piecesOf(reward).map((p, i) => ({ id: ++next, ...p, x, y: y - i * 48, delay: 120 + i * PIECE_GAP_MS }));
      if (made.length > 0) {
        setChips((c) => [...c, ...made]);
        const ids = new Set(made.map((c) => c.id));
        setTimeout(() => setChips((c) => c.filter((x) => !ids.has(x.id))), FLIGHT_MS + 600);
      }
      if (popped.length > 0) {
        setPieces((c) => [...c, ...popped]);
        const ids = new Set(popped.map((c) => c.id));
        setTimeout(() => setPieces((c) => c.filter((x) => !ids.has(x.id))), PIECE_MS + popped.length * PIECE_GAP_MS + 200);
      }
    },
    [reduced],
  );
  const view =
    (chips.length > 0 || pieces.length > 0) && typeof document !== 'undefined'
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
            {pieces.map((p) => (
              <span key={p.id} className={`claim-piece ${p.kind}`} data-tier={p.tier} style={{ left: `${p.x}px`, top: `${p.y}px`, animationDelay: `${p.delay}ms` }}>
                <Icon name={PIECE_ICON[p.kind]} />
                <small>{copy.missions.piece[p.kind]}</small>
                <b>{p.name}</b>
              </span>
            ))}
          </div>,
          document.body,
        )
      : null;
  return { burst, view };
}
