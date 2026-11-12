import type { PublicGalaxy } from '@galaxy/shared';
import { useCallback, useLayoutEffect, useRef } from 'react';
import { useGalaxyImage } from '../cards/useGalaxyImage';

// The profile's banner (Nov plan C2/C4, spec §6 C4): one of the player's galaxies, dark and blurred in the top corner
// of their profile, fading into the page; its special finish runs over it (the page itself carries a softer copy of
// the finish, see `.profile-root[data-finish]`). The blur is drawn once into a canvas, never a filter over moving
// layers.
const SIZE = 512;

export function ProfileBanner({ galaxy }: { galaxy: PublicGalaxy }) {
  const { ref, canvas } = useGalaxyImage(galaxy.seed, 96, SIZE);
  const art = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const host = art.current;
    if (!host || !canvas) return;
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext('2d');
    if (ctx) {
      ctx.filter = 'blur(6px) saturate(1.4) brightness(.9)';
      ctx.drawImage(canvas, 0, 0);
    }
    host.replaceChildren(out);
    return () => host.replaceChildren();
  }, [canvas]);
  const both = useCallback(
    (node: HTMLDivElement | null) => {
      art.current = node;
      ref(node);
    },
    [ref],
  );
  return (
    <div className="profile-banner" data-finish={galaxy.finish} aria-hidden="true">
      <div className="profile-banner-art" ref={both} />
      <div className="profile-banner-fx" />
    </div>
  );
}
