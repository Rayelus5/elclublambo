// Step 4 of the landing build (plan «galaxysurvivor.es», PR 4): Vite wrote the processed pages to dist/gen/; they move
// to dist/, the text files are written beside them, and dist/routes.json tells the server what serves each path.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
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
const routes = { files: site.map(({ route, file, type }) => ({ route, file, type })) };
writeFileSync(dist + 'routes.json', JSON.stringify(routes, null, 2) + '\n');
console.log(`finish: ${site.length} files, routes.json`);
