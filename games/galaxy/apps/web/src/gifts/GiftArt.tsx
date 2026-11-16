import type { Gift } from '@galaxy/shared';
import type { ReactNode } from 'react';
import { probeDrawing } from '../arena/sprites';
import { PieceArt } from '../cosmetics/PieceArt';
import { Icon } from '../ui/Icon';
import { useReducedMotion } from '../ui/motion';
import { SpriteLoop } from '../ui/SpriteLoop';
import { currencyLook, type GiftCatalog, giftWords } from './words';

// A gift drawn (mail v2, P3; the owner: «muy intuitiva y visual»): a currency's coin in its colour, the piece itself
// (the avatar, the frame round a face, the title in its style, the skin moving), a sealed galaxy card in its tier's
// colour with its finish's sheen, the probe flying, XP and season points as badges. Always next to its words: the
// drawing alone is decoration.

type View = Pick<GiftCatalog, 'events' | 'season' | 'cosmetics' | 'probes'>;

const PIECE_ICON = { avatar: 'clan', frame: 'cards', title: 'scroll', skin: 'probe' } as const;

/** `compact`: a small strip's (a pack, the sent list), where a piece or a probe is its icon. */
export function GiftArt({ gift, catalog, compact = false }: { gift: Gift; catalog: View; compact?: boolean }) {
  const reduced = useReducedMotion();
  if (compact && (gift.kind === 'cosmetic' || gift.kind === 'probe'))
    return (
      <span className={`gift-ico ${gift.kind === 'probe' ? 'k-ice' : 'k-uv'}`} aria-hidden="true">
        <Icon name={gift.kind === 'probe' ? 'probe' : PIECE_ICON[gift.piece]} />
      </span>
    );
  switch (gift.kind) {
    case 'currency': {
      const look = currencyLook(gift.currency, catalog);
      return (
        <span className={`gift-ico k-${look.tone}`} aria-hidden="true">
          <Icon name={look.icon} />
        </span>
      );
    }
    case 'cosmetic':
      // A title is words: its scroll here, its text and style in the words beside it.
      if (gift.piece === 'title')
        return (
          <span className="gift-ico k-uv" aria-hidden="true">
            <Icon name="scroll" />
          </span>
        );
      return (
        <span className="gift-ico piece" data-piece={gift.piece} aria-hidden="true">
          <PieceArt piece={{ kind: gift.piece, id: gift.id }} size={48} />
        </span>
      );
    case 'galaxy':
      return (
        <span className="gift-ico galaxy" data-tier={gift.tier} data-finish={gift.finish} aria-hidden="true">
          <span className="gift-galaxy-card">
            <Icon name="comet" />
          </span>
          {gift.count > 1 ? <b className="gift-count">×{gift.count}</b> : null}
        </span>
      );
    case 'probe': {
      const sprite = catalog.probes.find((p) => p.id === gift.probe)?.sprite ?? 'probe-lumen';
      return (
        <span className="gift-ico probe" aria-hidden="true">
          <SpriteLoop className="gift-probe" id={probeDrawing(null, sprite)} scale={2} reduced={reduced} width={48} height={48} />
        </span>
      );
    }
    case 'xp':
      return (
        <span className="gift-ico k-terminal" aria-hidden="true">
          <Icon name="up" />
        </span>
      );
    case 'seasonPoints':
      return (
        <span className="gift-ico k-sky" aria-hidden="true">
          <Icon name="podium" />
        </span>
      );
  }
}

/** A gift with its drawing and its words, and what to do with it (remove it, in the panel). */
export function GiftTile({ gift, catalog, children, problem }: { gift: Gift; catalog: View; children?: ReactNode; problem?: string | null }) {
  return (
    <li className={`gift-tile${problem ? ' bad' : ''}`}>
      <GiftArt gift={gift} catalog={catalog} />
      <span className="gift-tile-words">
        <span>{giftWords(gift, catalog)}</span>
        {problem ? <small className="gift-tile-problem">{problem}</small> : null}
      </span>
      {children}
    </li>
  );
}
