import { type ImgHTMLAttributes, useEffect, useState } from 'react';
import { spriteDef, spriteDataUrl } from '../arena/sprites';

// A drawing of the arena that moves outside it (plan «skins», part C2): the animated skins (and the probes' idle life)
// in the Taller, the lobby and the shop, its frames at its own pace; still on its first frame with reduced motion.

export function SpriteLoop({ id, scale, reduced, ...img }: { id: string; scale: number; reduced: boolean } & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'>) {
  const def = spriteDef(id);
  const frames = def?.frames.length ?? 1;
  const fps = def?.fps ?? 0;
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (reduced || frames < 2 || fps <= 0) return;
    const timer = setInterval(() => setFrame((f) => (f + 1) % frames), 1000 / fps);
    return () => clearInterval(timer);
  }, [reduced, frames, fps]);
  return <img alt="" draggable={false} {...img} src={spriteDataUrl(id, scale, reduced ? 0 : frame % frames)} />;
}
