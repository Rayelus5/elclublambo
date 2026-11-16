import type { PackArt as Art } from '@galaxy/shared';
import { packArtUrl } from '../mail/art';

/** A pack's art (mail v2, P4): its four-frame strip, played by CSS at an integer scale (still with reduced motion). */
export function PackArt({ art, className = '' }: { art: Art; className?: string }) {
  const url = packArtUrl(art);
  return <span className={`gift-pack-art ${className}`.trim()} data-art={art} aria-hidden="true" style={url ? { backgroundImage: `url(${url})` } : undefined} />;
}
