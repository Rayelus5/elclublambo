import { renderFromSeed } from '@galaxy/engine';
import type { Finish, GalaxySummary, NewsGalleryKey, Tier } from '@galaxy/shared';
import { type CSSProperties, createElement as h, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { spriteDataUrl } from '../../src/arena/sprites';
import { GalaxyCard } from '../../src/cards/GalaxyCard';
import { Icon, type IconName } from '../../src/ui/Icon';
import '../../src/styles/app.css';

// The news board's own images (the owner, 2026-11-14: «una imagen llamativa que siga el estilo del juego … todas las
// imágenes que debas generar hazlas tú»), drawn from the game's own pieces: its pixel sprites (probes and their skins,
// fauna, Cores, items), its galaxy cards (the engine's real galaxies) and its icons, over its deep-space colours.
// 960×540, no words (each card says its own). VITE_NEWS_ART=1 draws them into apps/web/src/news/art/<key>.png.

const W = 960;
const H = 540;
let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
});

/** A fixed pseudo-random sequence (the same art every time). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
    return (s & 0xffffff) / 0x1000000;
  };
}

const px = (n: number) => `${Math.round(n)}px`;

/** Stars: many small ones and a few bright crosses. */
function stars(seed: number, n = 140): ReactNode {
  const r = rng(seed);
  const dots = Array.from({ length: n }, (_, k) => {
    const size = r() < 0.86 ? 2 : 3;
    return h('i', { key: k, style: { position: 'absolute', left: px(r() * W), top: px(r() * H), width: px(size), height: px(size), background: r() < 0.7 ? '#bfe3ff' : '#f3f5ff', opacity: 0.25 + r() * 0.6 } });
  });
  return h('div', { style: { position: 'absolute', inset: 0 } }, dots);
}

/** A soft cloud of colour. */
const glow = (x: number, y: number, r: number, color: string, alpha = 0.55): ReactNode =>
  h('i', { style: { position: 'absolute', left: px(x - r), top: px(y - r), width: px(r * 2), height: px(r * 2), borderRadius: '50%', background: `radial-gradient(circle, ${color} 0%, transparent 68%)`, opacity: alpha, filter: 'blur(6px)' } });

/** A pixel sprite at `scale`, centred at (x, y). */
function sprite(id: string, x: number, y: number, scale: number, extra: CSSProperties = {}): ReactNode {
  return h('img', {
    src: spriteDataUrl(id, scale),
    style: { position: 'absolute', left: px(x), top: px(y), transform: 'translate(-50%, -50%)', imageRendering: 'pixelated', ...extra },
    draggable: false,
  });
}

/** One of the game's icons, big, in a colour, with its glow. */
const icon = (name: IconName, x: number, y: number, size: number, color: string): ReactNode =>
  h('span', { style: { position: 'absolute', left: px(x), top: px(y), transform: 'translate(-50%, -50%)', fontSize: px(size), color, filter: `drop-shadow(0 0 ${size / 6}px ${color})`, display: 'grid', lineHeight: 0 } }, h(Icon, { name }));

/** A real galaxy card (the engine's galaxy of that seed). */
function card(seed: number, name: string, tier: Tier, finish: Finish, x: number, y: number, size: number, rot = 0): ReactNode {
  const g: GalaxySummary = {
    id: `art-${seed}`,
    seed: String(seed),
    tier,
    finish,
    traits: renderFromSeed(BigInt(seed), { columns: 48 }).traits as unknown as Record<string, string>,
    name,
    designation: `GX-${(seed % 0xffffff).toString(16).toUpperCase().padStart(6, '0')}`,
    featured: false,
    level: 1,
    createdAt: '2026-11-14T00:00:00Z',
  };
  return h('div', { style: { position: 'absolute', left: px(x), top: px(y), transform: `translate(-50%, -50%) rotate(${rot}deg)` } }, h(GalaxyCard, { galaxy: g, size }));
}

/** A thruster trail behind a probe flying right. */
const trail = (x: number, y: number, len: number, color: string): ReactNode =>
  h('i', { style: { position: 'absolute', left: px(x - len), top: px(y - 3), width: px(len), height: '6px', borderRadius: '3px', background: `linear-gradient(90deg, transparent, ${color})`, opacity: 0.8 } });

/** A speech bubble with three dots (someone typing). */
const bubble = (x: number, y: number, w: number, color: string, shade: string): ReactNode =>
  h(
    'div',
    { style: { position: 'absolute', left: px(x), top: px(y), width: px(w), height: '50px', borderRadius: '16px', background: color, boxShadow: `0 6px 0 ${shade}`, display: 'flex', gap: '9px', alignItems: 'center', justifyContent: 'center' } },
    ...[0, 1, 2].map((k) => h('i', { key: k, style: { width: '10px', height: '10px', borderRadius: '50%', background: shade } })),
  );

/** A rounded block (podium, chat bubble, scanner…). */
const block = (x: number, y: number, w: number, hh: number, style: CSSProperties): ReactNode =>
  h('i', { style: { position: 'absolute', left: px(x), top: px(y), width: px(w), height: px(hh), ...style } });

function scene(bg: [string, string], seed: number, children: ReactNode[]): ReactNode {
  return h(
    'div',
    { className: 'news-art-scene', style: { position: 'relative', width: px(W), height: px(H), overflow: 'hidden', background: `radial-gradient(120% 120% at 30% 25%, ${bg[0]} 0%, ${bg[1]} 55%, #05061a 100%)` } },
    stars(seed),
    ...children,
    // A soft vignette, so a card's words read on any side.
    h('i', { style: { position: 'absolute', inset: 0, background: 'radial-gradient(130% 110% at 50% 45%, transparent 55%, rgb(3 4 16 / .55) 100%)' } }),
  );
}

const SCENES: Record<NewsGalleryKey, () => ReactNode> = {
  // Players together: probes of several skins in a ring around a shared light, with speech bubbles.
  comunidad: () =>
    scene(['#2a2f8f', '#0d1240'], 11, [
      glow(480, 290, 230, '#8c96ff', 0.6),
      ...[
        ['skin-lumen-coral', 300, 330],
        ['skin-prism-aurora', 400, 205],
        ['probe-spark', 560, 205],
        ['skin-bastion-chatarra', 660, 330],
        ['skin-comet-leyenda', 480, 410],
      ].map(([id, x, y]) => sprite(id as string, x as number, y as number, 6)),
      bubble(232, 214, 78, '#f3f5ff', '#8890c4'),
      bubble(636, 226, 84, '#ffc94a', '#c25f1c'),
      bubble(441, 104, 78, '#45e3a6', '#0b7352'),
      icon('chat', 480, 290, 70, '#f3f5ff'),
    ]),
  // The community on Discord: its face, big, in its blurple, with probes orbiting.
  discord: () =>
    scene(['#3b3fbf', '#11134a'], 12, [
      glow(480, 270, 260, '#5865f2', 0.75),
      block(355, 145, 250, 250, { borderRadius: '64px', background: 'linear-gradient(160deg, #6f79ff, #4752c4)', boxShadow: '0 12px 0 #2c338a, 0 0 70px rgb(88 101 242 / .7)' }),
      icon('discord', 480, 270, 180, '#ffffff'),
      sprite('skin-lumen-aurora', 225, 170, 5),
      sprite('probe-spark', 745, 160, 5),
      sprite('skin-prism-coral', 760, 400, 5),
      sprite('probe-bastion', 210, 395, 5),
    ]),
  // The season: a podium with three probes and a crown over the winner, confetti.
  temporada: () =>
    scene(['#5b2a8f', '#170c40'], 13, [
      glow(480, 250, 260, '#b39dff', 0.55),
      ...Array.from({ length: 46 }, (_, k) => {
        const r = rng(500 + k);
        return block(80 + r() * 800, 40 + r() * 260, 8, 14, { background: ['#ffc94a', '#ff4fd8', '#6fe3ff', '#45e3a6'][k % 4], transform: `rotate(${r() * 180}deg)`, borderRadius: '2px', opacity: 0.85 });
      }),
      block(390, 330, 180, 210, { background: 'linear-gradient(180deg, #ffd76a, #c98a1c)', borderRadius: '14px 14px 0 0', boxShadow: 'inset 0 6px 0 rgb(255 255 255 / .35)' }),
      block(210, 380, 180, 160, { background: 'linear-gradient(180deg, #d6dbf5, #8890c4)', borderRadius: '14px 14px 0 0', boxShadow: 'inset 0 6px 0 rgb(255 255 255 / .35)' }),
      block(570, 410, 180, 130, { background: 'linear-gradient(180deg, #ffad7a, #b0592c)', borderRadius: '14px 14px 0 0', boxShadow: 'inset 0 6px 0 rgb(255 255 255 / .3)' }),
      sprite('skin-comet-leyenda', 480, 280, 6),
      sprite('skin-lumen-coral', 300, 335, 5),
      sprite('probe-sentinel', 660, 365, 5),
      icon('trophy', 480, 190, 64, '#ffc94a'),
    ]),
  // The tournament: a golden trophy in rays, two probes squaring up and sparks.
  torneo: () =>
    scene(['#7a4a12', '#1d1030'], 14, [
      ...Array.from({ length: 14 }, (_, k) =>
        block(480 - 6, 250 - 300, 12, 600, { background: 'linear-gradient(180deg, transparent, rgb(255 201 74 / .22), transparent)', transformOrigin: '50% 50%', transform: `rotate(${k * (180 / 14)}deg)` }),
      ),
      glow(480, 250, 220, '#ffc94a', 0.6),
      icon('trophy', 480, 245, 200, '#ffc94a'),
      sprite('skin-prism-leyenda', 225, 330, 6, { transform: 'translate(-50%, -50%) scaleX(1)' }),
      sprite('skin-spark-coral', 735, 330, 6, { transform: 'translate(-50%, -50%) scaleX(-1)' }),
      trail(205, 330, 120, '#6fe3ff'),
      ...Array.from({ length: 18 }, (_, k) => {
        const r = rng(900 + k);
        return block(300 + r() * 360, 120 + r() * 300, 4, 4, { background: '#fff3c4', boxShadow: '0 0 8px #ffc94a', opacity: 0.9 });
      }),
    ]),
  // An event: a legendary galaxy card under comet streaks.
  evento: () =>
    scene(['#1f4f8f', '#0b1438'], 15, [
      glow(480, 270, 250, '#6fb7ff', 0.55),
      ...Array.from({ length: 6 }, (_, k) => block(120 + k * 120, 40 + (k % 3) * 40, 260, 4, { background: 'linear-gradient(90deg, transparent, #bfe3ff)', transform: 'rotate(28deg)', borderRadius: '4px', opacity: 0.55 })),
      card(9_000_017, 'Orsel', 'legendary', 'holo', 480, 280, 230, -4),
      sprite('skin-comet-aurora', 760, 150, 5),
      sprite('probe-lumen', 205, 420, 5),
    ]),
  // The scanner: its screen in the dark, a galaxy coming up in braille-like dots, a scan line.
  escaner: () =>
    scene(['#14385a', '#06132a'], 16, [
      glow(480, 270, 240, '#45e3a6', 0.45),
      block(250, 80, 460, 380, { borderRadius: '34px', background: 'linear-gradient(180deg, #20234f, #10122f)', boxShadow: 'inset 0 0 0 6px #2a2f6a, 0 14px 0 #0b0c24' }),
      block(280, 110, 400, 320, { borderRadius: '22px', background: 'radial-gradient(circle at 50% 45%, #0f3a33, #061814 72%)', boxShadow: 'inset 0 0 40px rgb(69 227 166 / .35)' }),
      card(9_000_421, 'Kathra', 'epic', 'braille', 480, 270, 170),
      block(280, 240, 400, 4, { background: 'linear-gradient(90deg, transparent, #45e3a6, transparent)', boxShadow: '0 0 16px #45e3a6', opacity: 0.9 }),
    ]),
  // The multipliers: three stacks of coins growing like a chart, dust shining around, a thick arrow going up over them.
  multiplicadores: () =>
    scene(['#6b4b10', '#1a1130'], 17, [
      glow(480, 330, 260, '#ffc94a', 0.55),
      glow(700, 160, 160, '#45e3a6', 0.35),
      ...[
        [300, 4],
        [480, 7],
        [660, 10],
      ].flatMap(([x, n]) => Array.from({ length: n as number }, (_, k) => sprite('coin', x as number, 470 - k * 26, 8))),
      ...Array.from({ length: 9 }, (_, k) => {
        const r = rng(1200 + k);
        return sprite('dust', 200 + r() * 560, 120 + r() * 300, 6, { opacity: 0.85 });
      }),
      h(
        'svg',
        { width: W, height: H, viewBox: `0 0 ${W} ${H}`, style: { position: 'absolute', inset: 0, filter: 'drop-shadow(0 0 14px #45e3a6)' } },
        h('polyline', { points: '170,400 330,300 470,330 700,150', fill: 'none', stroke: '#45e3a6', strokeWidth: 26, strokeLinejoin: 'round', strokeLinecap: 'round' }),
        h('polygon', { points: '760,100 650,118 735,205', fill: '#45e3a6', stroke: '#45e3a6', strokeWidth: 10, strokeLinejoin: 'round' }),
      ),
    ]),
  // The patch notes: an open scroll with its lines and a wrench and a star around it.
  notas: () =>
    scene(['#1d5a4a', '#08172a'], 18, [
      glow(480, 270, 230, '#45e3a6', 0.5),
      block(300, 110, 360, 330, { borderRadius: '22px', background: 'linear-gradient(180deg, #f3f5ff, #c9d0ea)', boxShadow: '0 12px 0 #8890c4, 0 0 60px rgb(69 227 166 / .35)', transform: 'rotate(-3deg)' }),
      ...Array.from({ length: 7 }, (_, k) => block(340, 160 + k * 36, k % 3 === 0 ? 200 : 280, 12, { borderRadius: '6px', background: k === 0 ? '#3a58e0' : '#8890c4', opacity: k === 0 ? 1 : 0.6, transform: 'rotate(-3deg)' })),
      icon('wrench', 690, 150, 80, '#45e3a6'),
      icon('plus', 260, 400, 64, '#ffc94a'),
      icon('star', 700, 400, 56, '#6fe3ff'),
    ]),
  // The market: three galaxy cards fanned out, with coins.
  mercado: () =>
    scene(['#3a2a7a', '#0d0d36'], 19, [
      glow(480, 280, 250, '#ffc94a', 0.4),
      card(9_001_003, 'Thaselos', 'rare', 'normal', 340, 290, 170, -14),
      card(9_001_221, 'Zenreila', 'epic', 'prismatic', 620, 290, 170, 14),
      card(9_001_117, 'Selem', 'legendary', 'holo', 480, 270, 190, 0),
      ...Array.from({ length: 10 }, (_, k) => {
        const r = rng(1500 + k);
        return sprite('coin', 230 + r() * 500, 440 + r() * 70, 5);
      }),
    ]),
  // Clans: three banners in their colours, with probes under them.
  clanes: () =>
    scene(['#2a4a8f', '#0b1238'], 20, [
      glow(480, 260, 260, '#4767f2', 0.5),
      ...[
        [300, '#ff6b7a', 'shield'],
        [480, '#ffc94a', 'clan'],
        [660, '#45e3a6', 'star'],
      ].map(([x, color, name], k) =>
        h(
          'div',
          { key: k, style: { position: 'absolute', left: px((x as number) - 70), top: px(k === 1 ? 70 : 100), width: '140px', height: '220px', background: `linear-gradient(180deg, ${color as string}, color-mix(in oklab, ${color as string} 55%, black))`, clipPath: 'polygon(0 0, 100% 0, 100% 82%, 50% 100%, 0 82%)', display: 'grid', placeItems: 'center' } },
          h('span', { style: { fontSize: '64px', color: '#0b0e2a', lineHeight: 0, display: 'grid' } }, h(Icon, { name: name as IconName })),
        ),
      ),
      sprite('skin-bastion-coral', 300, 400, 5),
      sprite('skin-lumen-leyenda', 480, 420, 5),
      sprite('skin-echo-aurora', 660, 400, 5),
    ]),
  // A group run: four probes in formation with their trails, towards the Static's fauna and a Core.
  grupo: () =>
    scene(['#3a1050', '#0d0b2a'], 21, [
      glow(700, 270, 220, '#ff4d6d', 0.35),
      glow(300, 270, 220, '#6fe3ff', 0.4),
      ...[
        ['skin-lumen-coral', 330, 200],
        ['probe-spark', 390, 270],
        ['skin-bastion-aurora', 330, 340],
        ['skin-prism-chatarra', 250, 270],
      ].flatMap(([id, x, y]) => [trail(x as number, y as number, 110, '#6fe3ff'), sprite(id as string, x as number, y as number, 5)]),
      sprite('echo-core', 760, 270, 4),
      sprite('mite', 620, 170, 4),
      sprite('cell', 640, 370, 4),
      sprite('spitter', 560, 300, 4),
    ]),
  // The Mythic: the iridescent void card glowing in its four tones.
  mitica: () =>
    scene(['#3a1050', '#07051a'], 22, [
      glow(400, 260, 200, '#ff4fd8', 0.55),
      glow(560, 280, 200, '#6fe3ff', 0.45),
      glow(480, 380, 160, '#ffc94a', 0.3),
      card(9_002_002, 'Vaelith', 'mythic', 'holo', 480, 270, 240, 0),
      ...Array.from({ length: 24 }, (_, k) => {
        const r = rng(1900 + k);
        return block(200 + r() * 560, 60 + r() * 420, 5, 5, { background: ['#ff4fd8', '#6fe3ff', '#ffc94a', '#b39dff'][k % 4], boxShadow: '0 0 10px currentColor', borderRadius: '1px' });
      }),
    ]),
};

test.skipIf(!import.meta.env['VITE_NEWS_ART'])('dibuja las imágenes del tablón de noticias', async () => {
  await page.viewport(W + 40, H + 40);
  document.body.style.cssText = 'margin:0;background:#05061a;';
  for (const [key, draw] of Object.entries(SCENES)) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    flushSync(() => root!.render(draw()));
    // The galaxy cards compose in WebGL: wait for them.
    const cards = host.querySelectorAll('article.gcard');
    if (cards.length > 0) await expect.poll(() => host.querySelectorAll('article[data-image="ready"]').length, { timeout: 30_000 }).toBe(cards.length);
    await new Promise((r) => setTimeout(r, 200));
    const el = host.querySelector<HTMLElement>('.news-art-scene')!;
    await page.screenshot({ path: `../../src/news/art/${key}.png`, element: el });
    root.unmount();
    root = null;
    host.remove();
  }
}, 180_000);
