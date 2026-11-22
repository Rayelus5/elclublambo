// Bundles one campaign of «Encuestas y avisos» for the CLI's popup-draft (plan 2026-11-22, part A): the file's
// `{ record, id?, image? }` on stdout, with `image` (a path next to the file) turned into `{ name, data }` in base64, so
// the container, which cannot see the repo, gets the picture too.
//   node games/galaxy/scripts/popup-bundle.mjs games/galaxy/ops/launch/<carpeta>/avisos/<campaña>.json | ssh <PRE> "docker exec -i elclub-pre-galaxy-1 node dist/cli.js popup-draft - --reason '<motivo>'"
import { readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const file = process.argv[2];
if (!file || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
  process.stderr.write('Uso: node scripts/popup-bundle.mjs <campaña.json>\n');
  process.exit(1);
}
// A BOM (files saved from PowerShell) would break JSON.parse here and on the server.
const text = readFileSync(file, 'utf8');
const campaign = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
if (typeof campaign.image === 'string') {
  const path = join(dirname(file), campaign.image);
  campaign.image = { name: basename(path), data: readFileSync(path).toString('base64') };
}
process.stdout.write(JSON.stringify(campaign));
