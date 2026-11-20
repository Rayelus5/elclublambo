// Landing assets (plan «galaxysurvivor.es», PR 4): the faces of the five galaxies in the scanner's hand, rendered once
// from @galaxy/engine (the card look: glowing dots) and committed as WebP, so the page needs no engine at runtime.
// Run from games/galaxy/apps/landing:  node scripts/faces.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const OUT = fileURLToPath(new URL('../src/assets/galaxies/', import.meta.url));
// tier key → seed: real galaxies (their names come from the seed), one of each tier the hand shows.
const HAND = { rare: '7095029', epic: '7039596', legendary: '17453394667225957625', uncommon: '7000001', mythic: '16555340779960930048' };
const SIZE = 400;

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { renderFromSeed } = await vite.ssrLoadModule('@galaxy/engine');
const { galaxyOfSeed } = await vite.ssrLoadModule('@galaxy/shared');

const toSrgb = (x) => {
  const t = x / (1 + x);
  const g = t <= 0.0031308 ? 12.92 * t : 1.055 * Math.pow(t, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(g * 255 * 1.35)));
};

const browser = await chromium.launch();
const page = await browser.newPage();
mkdirSync(OUT, { recursive: true });
const meta = {};
for (const [tier, seed] of Object.entries(HAND)) {
  const r = renderFromSeed(BigInt(seed), { columns: 96 });
  const dots = [];
  for (let y = 0; y < r.ny; y++)
    for (let x = 0; x < r.nx; x++) {
      const k = y * r.nx + x;
      if (r.on[k]) dots.push([x, y, r.dotRadius[k], toSrgb(r.dotColor[3 * k]), toSrgb(r.dotColor[3 * k + 1]), toSrgb(r.dotColor[3 * k + 2])]);
    }
  const dataUrl = await page.evaluate(
    ({ dots, d, size }) => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const ctx = cv.getContext('2d');
      const off = document.createElement('canvas');
      off.width = off.height = size;
      const o = off.getContext('2d');
      const s = size / d.width;
      for (const [x, y, rad, R, G, B] of dots) {
        o.fillStyle = `rgb(${R},${G},${B})`;
        o.beginPath();
        o.arc((x * d.step + d.step / 2) * s, (d.oy + y * d.step + d.step / 2) * s, Math.max(0.5, rad * s), 0, 6.2832);
        o.fill();
      }
      ctx.fillStyle = '#03040d';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(off, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.filter = `blur(${size / 90}px)`;
      ctx.globalAlpha = 0.9;
      ctx.drawImage(off, 0, 0);
      ctx.filter = `blur(${size / 30}px)`;
      ctx.globalAlpha = 0.55;
      ctx.drawImage(off, 0, 0);
      return cv.toDataURL('image/webp', 0.86);
    },
    { dots, d: { step: r.step, oy: r.oy, width: r.width }, size: SIZE },
  );
  writeFileSync(`${OUT}${tier}.webp`, Buffer.from(dataUrl.split(',')[1], 'base64'));
  const g = galaxyOfSeed(BigInt(seed));
  meta[tier] = { name: g.name, designation: g.designation };
}
writeFileSync(`${OUT}galaxies.json`, JSON.stringify(meta, null, 2) + '\n');
await browser.close();
await vite.close();
console.log(meta);
