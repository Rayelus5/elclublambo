import { useCosmeticsView } from '../api/cosmetics';
import { Avatar } from '../hub/Avatar';
import { TitleText } from '../profile/TitleText';
import { SpriteLoop } from '../ui/SpriteLoop';
import { useReducedMotion } from '../ui/motion';

/**
 * A cosmetic's piece, drawn (Nov plan C5; shared since mail v2): the avatar, a frame round the default face, the title
 * in its style, or a probe skin moving (plan «skins», C2), in the middle of its art box. `size`: the avatar's side (96
 * on a card, which a frame grows to 144).
 */
export function PieceArt({ piece, className, size = 64 }: { piece: { kind: 'avatar' | 'frame' | 'title' | 'skin'; id: string }; className?: string; size?: 48 | 64 | 96 }) {
  const catalog = useCosmeticsView().data?.catalog;
  const reduced = useReducedMotion();
  // A 24 px skin at a whole multiple of its pixels: 96 on a card (×4), 48 elsewhere (×2).
  const art =
    piece.kind === 'title' ? (
      <TitleText text={piece.id} catalog={catalog} />
    ) : piece.kind === 'skin' ? (
      <SpriteLoop className="piece-skin" id={piece.id} scale={size === 96 ? 4 : 2} reduced={reduced} width={size === 96 ? 96 : 48} height={size === 96 ? 96 : 48} />
    ) : (
      <Avatar name="ECN" avatar={piece.kind === 'avatar' ? piece.id : 'crew-pilot'} frame={piece.kind === 'frame' ? piece.id : null} size={size} />
    );
  return (
    <span className={`piece-art ${className ?? ''}`.trim()} aria-hidden="true">
      {art}
    </span>
  );
}
