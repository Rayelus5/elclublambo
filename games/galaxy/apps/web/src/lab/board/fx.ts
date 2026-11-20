import { getSettings, sfxOut } from '../../audio/mixer';
import { tone } from '../../audio/synth';

// The whiteboard's sounds and sparks (shop and lab plan, F3; the approved F0 mockup), synthesised on the effects bus:
// a soft tick when a node is chosen, an arpeggio that climbs with the level bought and a chord at the top, and a chime
// for each node that opens. The sparks are SVG circles animated with the Web Animations API (attributes and
// transforms, which the CSP allows), and none with reduced motion.

export function playSelect(): void {
  const bus = sfxOut();
  if (!bus || getSettings().muted) return;
  tone(bus.ctx, bus.out, bus.ctx.currentTime, 620, 620, 0.05, 0.03, 'square');
}

export function playLevel(level: number, max: number): void {
  const bus = sfxOut();
  if (!bus || getSettings().muted) return;
  const { ctx, out } = bus;
  const t = ctx.currentTime;
  const base = 392 * 2 ** ((level - 1) / 8);
  [1, 1.25, 1.5].forEach((m, i) => tone(ctx, out, t + i * 0.07, base * m, base * m, 0.25, 0.05, 'triangle'));
  if (level >= max) [1046.5, 1318.5, 1568, 2093].forEach((hz, i) => tone(ctx, out, t + 0.25 + i * 0.08, hz, hz, 0.6, 0.045, 'sine'));
}

export function playOpen(i: number): void {
  const bus = sfxOut();
  if (!bus || getSettings().muted) return;
  const hz = 880 + i * 120;
  tone(bus.ctx, bus.out, bus.ctx.currentTime + 0.2 + i * 0.12, hz, hz, 0.12, 0.03, 'sine');
}

const NS = 'http://www.w3.org/2000/svg';

/** A burst of sparks and a ring from a node (world coordinates, inside `layer`). */
export function burst(layer: SVGGElement, x: number, y: number, color: string): void {
  if (typeof layer.animate !== 'function') return;
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + ((i * 7) % 5) * 0.11;
    const d = 50 + ((i * 37) % 70);
    const s = document.createElementNS(NS, 'circle');
    s.setAttribute('cx', String(x));
    s.setAttribute('cy', String(y));
    s.setAttribute('r', String(3 + (i % 3)));
    s.setAttribute('fill', i % 3 ? color : '#ffffff');
    s.setAttribute('class', 'lab-spark');
    layer.appendChild(s);
    s.animate([{ transform: 'translate(0, 0)', opacity: 1 }, { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px)`, opacity: 0 }], {
      duration: 650 + ((i * 53) % 300),
      easing: 'cubic-bezier(.2, .8, .3, 1)',
    }).onfinish = () => s.remove();
  }
  const ring = document.createElementNS(NS, 'circle');
  ring.setAttribute('cx', String(x));
  ring.setAttribute('cy', String(y));
  ring.setAttribute('r', '34');
  ring.setAttribute('fill', 'none');
  ring.setAttribute('stroke', color);
  ring.setAttribute('stroke-width', '4');
  ring.setAttribute('class', 'lab-spark');
  layer.appendChild(ring);
  ring.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(2.6)', opacity: 0 }], { duration: 600, easing: 'ease-out' }).onfinish = () => ring.remove();
}
