import type { PulledGalaxy } from '@galaxy/shared';
import { PALETTES } from '@galaxy/engine';
import { drawFront, drawStarfield, H, W } from '../../inspector/textures';

// The cards of the pro scanner's cinematic (plan «escáner pro», part B), drawn once with the 2D canvas and handed to
// three.js as textures. The face is the inspector's own (DESIGN_SYSTEM §7: the tier frame, the plate with its name,
// designation and tier, the level and finish chips) with the starfield and the engine's galaxy in its window — one
// flat image, since in the cinematic the card turns and flies instead of tilting under the pointer. The back is the
// same for every card, so nothing on it gives the tier away before it turns: only its edge lights first.

/** The art window inside the 1000×1400 card (inspector/textures.ts). */
const WINDOW = { x: 50, y: 50, size: 900, r: 45 };

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/**
 * A card's face at `width` px (5:7): the starfield, its galaxy (light added, so its black lets the stars through; an
 * inverted palette drawn as it is), and the frame with its plate on top. Without an image yet, the window shows only
 * its stars (the cinematic swaps the texture in when the image arrives).
 */
export function composeCardFace(g: PulledGalaxy & { level?: number }, image: HTMLCanvasElement | null, width = 720): HTMLCanvasElement {
  const k = width / W;
  const [c, ctx] = canvas(width, Math.round(H * k));
  ctx.save();
  ctx.scale(k, k);
  ctx.beginPath();
  ctx.roundRect(WINDOW.x, WINDOW.y, WINDOW.size, WINDOW.size, WINDOW.r);
  ctx.clip();
  ctx.drawImage(drawStarfield(g.seed), WINDOW.x, WINDOW.y, WINDOW.size, WINDOW.size);
  if (image) {
    const inverted = PALETTES.get(g.traits['palette'] ?? '')?.mode === 'inverted';
    ctx.globalCompositeOperation = inverted ? 'source-over' : 'lighter';
    ctx.drawImage(image, WINDOW.x, WINDOW.y, WINDOW.size, WINDOW.size);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
  ctx.drawImage(drawFront(g), 0, 0, c.width, c.height);
  return c;
}

/** The back every card shows face down: deep space, a silver frame and the scanner's braille sigil. */
export function drawCardBack(width = 720): HTMLCanvasElement {
  const k = width / W;
  const [c, ctx] = canvas(width, Math.round(H * k));
  ctx.scale(k, k);
  // The frame: brushed silver with light from the top left.
  const frame = ctx.createLinearGradient(0, 0, W * 0.7, H);
  frame.addColorStop(0, '#e9ecff');
  frame.addColorStop(0.4, '#9aa3d6');
  frame.addColorStop(1, '#3b4174');
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, 70);
  ctx.fillStyle = frame;
  ctx.fill();
  // The field: deep space with a faint nebula and stars.
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(42, 42, W - 84, H - 84, 52);
  ctx.clip();
  const field = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, H * 0.62);
  field.addColorStop(0, '#2a1f6e');
  field.addColorStop(0.45, '#12123a');
  field.addColorStop(1, '#05060f');
  ctx.fillStyle = field;
  ctx.fillRect(0, 0, W, H);
  let s = 12345;
  const rand = () => (s = (s * 48271) % 2147483647) / 2147483647;
  for (let i = 0; i < 220; i++) {
    ctx.fillStyle = `rgba(220,228,255,${0.15 + rand() * 0.55})`;
    ctx.beginPath();
    ctx.arc(rand() * W, rand() * H, rand() < 0.9 ? 1.6 : 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  // Rings around the sigil, and the sigil itself (⠎⠉⠁⠝, «scan» in braille).
  ctx.strokeStyle = 'rgba(191,227,255,.35)';
  for (const [r, w] of [
    [300, 4],
    [250, 2],
    [190, 6],
  ] as const) {
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  const dots = [
    [0, 1, 1, 1, 0, 0],
    [1, 0, 0, 1, 0, 0],
    [1, 0, 0, 0, 0, 0],
    [1, 0, 1, 1, 1, 0],
  ];
  const cell = 46;
  const x0 = W / 2 - (dots.length * 2 * cell + (dots.length - 1) * cell) / 2 + cell / 2;
  dots.forEach((d, i) => {
    for (let j = 0; j < 6; j++) {
      const col = j < 3 ? 0 : 1;
      const row = j % 3;
      const x = x0 + i * 3 * cell + col * cell;
      const y = H / 2 - cell + row * cell;
      ctx.fillStyle = d[j] ? '#f3f5ff' : 'rgba(243,245,255,.12)';
      ctx.beginPath();
      ctx.arc(x, y, d[j] ? 15 : 9, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  ctx.restore();
  return c;
}
