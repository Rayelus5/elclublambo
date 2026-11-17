import type { ShopProductView } from '@galaxy/shared';
import { useEffect, useState } from 'react';
import { useCosmeticsView } from '../api/cosmetics';
import { copy } from '../copy/es';
import { PieceArt } from '../cosmetics/PieceArt';
import { Icon } from '../ui/Icon';
import { SpriteLoop } from '../ui/SpriteLoop';

// A complete skin pack's art (2026-11-17): its pieces in a grid, the ones the player has already marked. The shop
// shows several packs at once, so on a card only one moves at a time, in turn, and all of them while the card is
// pointed at or focused (`live`); none with reduced motion.

const SPOT_MS = 1400;

export function SetArt({ pieces, reduced, live, scale = 2, className }: { pieces: NonNullable<ShopProductView['pieces']>; reduced: boolean; live: boolean; scale?: 2 | 3; className?: string }) {
  const skins = useCosmeticsView().data?.catalog?.skins;
  const [spot, setSpot] = useState(0);
  useEffect(() => {
    if (reduced || live || pieces.length < 2) return;
    const timer = setInterval(() => setSpot((s) => (s + 1) % pieces.length), SPOT_MS);
    return () => clearInterval(timer);
  }, [reduced, live, pieces.length]);
  const size = 24 * scale;
  return (
    <ul className={`set-art ${className ?? ''}`.trim()} aria-label={copy.shop.set.list}>
      {pieces.map((p, i) => {
        const moving = !reduced && (live || i === spot);
        const name = skins?.find((s) => s.id === p.id)?.name ?? copy.shop.piece[p.kind];
        const label = p.owned ? copy.shop.set.ownedPiece(name) : name;
        return (
          <li key={`${p.kind}:${p.id}`} className={`set-piece${p.owned ? ' owned' : ''}${moving ? ' moving' : ''}`}>
            {p.kind === 'skin' ? (
              <SpriteLoop id={p.id} scale={scale} reduced={!moving} width={size} height={size} alt={label} />
            ) : (
              <span role="img" aria-label={label}>
                <PieceArt piece={p} size={48} />
              </span>
            )}
            {p.owned ? <Icon name="check" className="ico set-check" /> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** How many of a set's pieces the player has. */
export function ownedCount(p: Pick<ShopProductView, 'pieces'>): number {
  return p.pieces?.filter((x) => x.owned).length ?? 0;
}

/** The last day a product is on sale, in Madrid («6 de enero»): the day before its end at midnight. */
export function lastSaleDay(until: string): string {
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' }).format(new Date(Date.parse(until) - 1));
}
