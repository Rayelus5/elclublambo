// Landing assets (plan «galaxysurvivor.es», PR 4): the social preview card (1200×630) shown by Discord, WhatsApp, X and
// search engines, drawn with the game's fonts and art and committed as public/og/og-es-v1.jpg. A new design gets a new
// version in its name (social sites cache images by URL).
// Run from games/galaxy/apps/landing:  node scripts/og.mjs
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const here = (p) => pathToFileURL(fileURLToPath(new URL(p, import.meta.url))).href;
const OUT = fileURLToPath(new URL('../public/og/', import.meta.url));

const html = `<!doctype html><html lang="es"><meta charset="utf-8"><style>
@font-face { font-family: Bungee; src: url('${here('../../web/public/fonts/bungee-latin.woff2')}'); }
@font-face { font-family: Fredoka; font-weight: 300 700; src: url('${here('../../web/public/fonts/fredoka-latin.woff2')}'); }
html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
body { background: radial-gradient(700px 500px at 78% 45%, #3a2a9a 0%, transparent 70%), radial-gradient(600px 420px at 8% 100%, #13805c55 0%, transparent 70%), #070a1c; color: #f3f5ff; font-family: Fredoka; position: relative; }
.stars { position: absolute; inset: 0; background-image: radial-gradient(1.5px 1.5px at 40px 60px, #fff9 50%, transparent), radial-gradient(1px 1px at 170px 140px, #bfe3ffaa 50%, transparent), radial-gradient(2px 2px at 300px 30px, #ffc94a99 50%, transparent); background-size: 340px 220px; }
.brand { position: absolute; left: 72px; top: 64px; display: flex; gap: 16px; align-items: center; }
.brand img { width: 56px; height: 56px; }
.brand b { font-family: Bungee; font-size: 30px; line-height: .95; font-weight: 400; }
h1 { position: absolute; left: 72px; top: 196px; margin: 0; font-family: Bungee; font-weight: 400; font-size: 84px; line-height: .92; text-shadow: 0 7px 0 #0b0c24; width: 640px; }
h1 span { display: block; color: #ffc94a; }
p { position: absolute; left: 72px; top: 420px; margin: 0; font-size: 30px; color: #b9bfe6; width: 600px; line-height: 1.3; }
.card { position: absolute; right: 120px; top: 92px; width: 300px; height: 430px; border-radius: 26px; padding: 13px; box-sizing: border-box; transform: rotate(5deg);
  background: linear-gradient(160deg, #ffe08a, #b88a1e); box-shadow: 0 0 80px #ffc94a66, 0 24px 50px #0008; display: flex; flex-direction: column; gap: 11px; }
.card img { width: 100%; aspect-ratio: 1; border-radius: 16px; display: block; }
.plate { flex: 1; border-radius: 16px; background: linear-gradient(180deg, #262a5e, #1b1d47); padding: 12px 18px; display: flex; flex-direction: column; justify-content: center; }
.plate b { font-size: 28px; } .plate i { font-style: normal; color: #ffc94a; font-weight: 600; font-size: 20px; }
.probe { position: absolute; right: 400px; bottom: 52px; width: 120px; height: 120px; background: url('${here('../../../art/probes/spark.png')}') 0 0 / 480px 120px; image-rendering: pixelated; transform: rotate(-20deg); filter: drop-shadow(0 0 18px #9b86ffaa); }
</style><body><div class="stars"></div>
<div class="brand"><img src="${here('../public/favicon.svg')}" alt=""><b>Galaxy<br>Survivor</b></div>
<h1>Sobrevive a <span>la Estática</span></h1>
<p>Roguelite de hordas gratis en el navegador. Juega solo o en grupo</p>
<div class="card"><img src="${here('../src/assets/galaxies/legendary.webp')}" alt=""><div class="plate"><b>Draylvi</b><i>Legendaria</i></div></div>
<div class="probe"></div>
</body></html>`;

const dir = mkdtempSync(join(tmpdir(), 'gs-og-'));
const file = join(dir, 'og.html');
writeFileSync(file, html);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(pathToFileURL(file).href);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(OUT, 'og-es-v1.jpg'), type: 'jpeg', quality: 88 });
await browser.close();
console.log('ok');
