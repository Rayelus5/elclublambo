// Step 4 of the landing build (plan «galaxysurvivor.es», PR 4): Vite wrote the processed pages to dist/gen/; they move
// to dist/, the text files are written beside them, and dist/routes.json lists every file the server serves at a
// fixed path: the pages (at their clean routes; the 404 with no route), the text files and the public files (icons,
// the social card, the screenshots). Everything hashed lives in dist/static/, which the server serves on its own.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/');
const site = JSON.parse(readFileSync(here('../gen/site.json'), 'utf8'));
for (const f of site) {
  const out = dist + f.file;
  mkdirSync(dirname(out), { recursive: true });
  if (f.type.startsWith('text/html')) renameSync(dist + 'gen/' + f.file, out);
  else writeFileSync(out, f.body);
}
if (existsSync(dist + 'gen')) rmSync(dist + 'gen', { recursive: true });

const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const known = new Set(site.map((f) => f.file));
const files = site.map(({ route, file, type }) => ({ route, file, type }));
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
for (const full of walk(dist)) {
  const file = relative(dist, full).replace(/\\/g, '/');
  if (file.startsWith('static/') || file === 'routes.json' || known.has(file)) continue;
  const type = TYPES[extname(file)];
  if (!type) throw new Error(`finish: no content type for ${file}`);
  files.push({ route: `/${file}`, file, type });
}
writeFileSync(dist + 'routes.json', JSON.stringify({ files }, null, 2) + '\n');
console.log(`finish: ${files.length} routes`);
