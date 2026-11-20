// Step 2 of the landing build (plan «galaxysurvivor.es», PR 4): renders every file of the site with the SSR module
// (dist-ssr/entry.js), writes the pages into gen/ for Vite, and keeps the files written as they are (robots.txt,
// sitemap.xml, security.txt, the old address's notice and its stylesheet) and the route list in gen/site.json for
// scripts/finish.mjs.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const { renderSite } = await import(pathToFileURL(here('../dist-ssr/entry.js')).href);
const gen = here('../gen/');
rmSync(gen, { recursive: true, force: true });
mkdirSync(gen, { recursive: true });
const files = renderSite({ now: new Date() });
const isPage = (f) => f.type.startsWith('text/html') && !f.raw;
for (const f of files) if (isPage(f)) writeFileSync(gen + f.file, f.body);
writeFileSync(
  gen + 'site.json',
  JSON.stringify(files.map((f) => ({ route: f.route, file: f.file, type: f.type, role: f.role, page: isPage(f), body: isPage(f) ? undefined : f.body }))),
);
console.log(`prerender: ${files.length} files`);
