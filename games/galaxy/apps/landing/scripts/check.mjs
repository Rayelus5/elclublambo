// Local check of the built landing (plan «galaxysurvivor.es», PR 4), in a real Chromium, with the game server's CSP:
// every size without sideways overflow nor console or CSP errors, the page whole without JavaScript, nothing moving or
// playing with reduced motion, no clip downloaded before it is reached, and the phone notice for «Jugar gratis».
// Screenshots go to __shots__/ (ignored). Run after `pnpm build`:  node scripts/check.mjs
import { createReadStream, existsSync, readFileSync, statSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/');
const shots = here('../__shots__/');
mkdirSync(shots, { recursive: true });
// The game server's CSP, read from its source so this check follows it.
const headers = readFileSync(here('../../server/src/security/headers.ts'), 'utf8');
const CSP = [...headers.matchAll(/^\s+"([a-z-]+ [^"]+)",?$/gm)].map((m) => m[1]).join('; ');
if (!CSP.includes("style-src 'self'")) throw new Error('could not read the CSP');
const routes = Object.fromEntries(JSON.parse(readFileSync(dist + 'routes.json', 'utf8')).files.filter((f) => f.route).map((f) => [f.route, f.file]));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.txt': 'text/plain', '.xml': 'application/xml' };

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = routes[path] ?? path.slice(1);
  let status = 200;
  if (!file || !existsSync(dist + file) || statSync(dist + file).isDirectory()) [file, status] = ['404.html', 404];
  res.writeHead(status, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-security-policy': CSP });
  createReadStream(join(dist, file)).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.log(`  ✗ ${msg}`);
};

async function open(page, path) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP: ${e.violatedDirective} ${e.blockedURI}`)));
  await page.goto(base + path, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  return errors;
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

// 1. Every size: no overflow, no errors, the H1 seen, no clip downloaded at the top; screenshots of every stop.
for (const [w, h] of [[1280, 720], [1600, 900], [1920, 1080], [2560, 1440]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const mp4 = [];
  page.on('request', (r) => r.url().endsWith('.mp4') && mp4.push(r.url()));
  const errors = await open(page, '/');
  await page.waitForTimeout(600);
  if (mp4.length) fail(`${w}: clips requested at the top (${mp4.length})`);
  if (!(await page.locator('h1').isVisible())) fail(`${w}: H1 not visible`);
  const n = await page.evaluate(() => document.querySelectorAll('main > section').length);
  for (let i = 0; i < n; i++) {
    await page.evaluate((i) => {
      const s = document.querySelectorAll('main > section')[i];
      scrollTo({ top: s.offsetTop + s.offsetHeight / 2 - innerHeight / 2, behavior: 'instant' });
    }, i);
    await page.waitForTimeout(i === 0 ? 300 : 1300);
    if ((await overflow(page)) > 0) fail(`${w}: overflow at section ${i}`);
    await page.screenshot({ path: `${shots}home-${w}-${String(i).padStart(2, '0')}.png` });
  }
  if (errors.length) fail(`${w}: ${errors.join(' | ')}`);
  console.log(`${w}×${h}: ${n} sections`);
  await page.close();
}

// 2. Phone: whole page, no overflow, «Jugar gratis» opens the notice instead of the game.
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errors = await open(page, '/');
  if ((await overflow(page)) > 0) fail('phone: overflow');
  await page.screenshot({ path: `${shots}phone-top.png` });
  await page.locator('.hero [data-play]').click();
  if (!(await page.locator('#desktop-only').isVisible())) fail('phone: notice not shown');
  if (!page.url().endsWith('/')) fail(`phone: navigated to ${page.url()}`);
  await page.screenshot({ path: `${shots}phone-notice.png` });
  await page.keyboard.press('Escape');
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight / 2));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${shots}phone-middle.png` });
  if (errors.length) fail(`phone: ${errors.join(' | ')}`);
  await ctx.close();
}

// 3. Without JavaScript: every section title is visible (reveals only hide under html.js).
{
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(base + '/');
  const hidden = await page.evaluate(() => [...document.querySelectorAll('h1, h2, .gcard, .tile, .ping')].filter((e) => getComputedStyle(e).opacity === '0' || getComputedStyle(e).clipPath.includes('0%')).length);
  if (hidden) fail(`no JS: ${hidden} elements hidden`);
  await ctx.close();
}

// 4. Reduced motion: no clip plays, nothing hidden, no route.
{
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  await open(page, '/');
  for (const id of ['incursion', 'nucleo', 'grupo']) {
    await page.evaluate((id) => document.getElementById(id).scrollIntoView(), id);
    await page.waitForTimeout(700);
  }
  const playing = await page.evaluate(() => [...document.querySelectorAll('video')].filter((v) => !v.paused).length);
  if (playing) fail(`reduced motion: ${playing} clips playing`);
  if (await page.locator('#route').isVisible()) fail('reduced motion: the route is shown');
  await ctx.close();
}

// 5. The legal pages and the 404.
for (const path of ['/aviso-legal', '/privacidad', '/cookies', '/condiciones', '/nada']) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = await open(page, path);
  if ((await overflow(page)) > 0) fail(`${path}: overflow`);
  // The 404 page itself is answered with a 404, which Chromium logs.
  const real = errors.filter((e) => !(path === '/nada' && e.includes('status of 404')));
  if (real.length) fail(`${path}: ${real.join(' | ')}`);
  await page.screenshot({ path: `${shots}page${path.replace(/\//g, '-')}.png`, fullPage: path === '/privacidad' });
  await page.close();
}

await browser.close();
server.close();
console.log(failures.length ? `\n${failures.length} problems` : '\nall good');
process.exit(failures.length ? 1 : 0);
