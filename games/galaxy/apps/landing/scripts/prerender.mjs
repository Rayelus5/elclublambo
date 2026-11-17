// Step 2 of the landing build (plan «galaxysurvivor.es», PR 4): renders every file of the site with the SSR module
// (dist-ssr/entry.js), writes the pages into gen/ for Vite, and keeps the text files (robots.txt, sitemap.xml,
// security.txt) and the route list in gen/site.json for scripts/finish.mjs.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const { renderSite } = await import(pathToFileURL(here('../dist-ssr/entry.js')).href);
const gen = here('../gen/');
rmSync(gen, { recursive: true, force: true });
mkdirSync(gen, { recursive: true });
const files = renderSite({ now: new Date() });
for (const f of files) if (f.type.startsWith('text/html')) writeFileSync(gen + f.file, f.body);
writeFileSync(
  gen + 'site.json',
  JSON.stringify(files.map(({ route, file, type, body }) => ({ route, file, type, body: type.startsWith('text/html') ? undefined : body }))),
);
console.log(`prerender: ${files.length} files`);
