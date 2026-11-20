// Bundles an ops/launch folder for the CLI's check-config (docs/CONTENIDO.md B2): every `<clave>.json` at the folder's
// top level becomes `{ "<clave>": <su contenido>, … }` on stdout (LEEME.md and the `antes/` copies are left out).
//   node games/galaxy/scripts/ops-bundle.mjs games/galaxy/ops/launch/<carpeta> | ssh <PRE> "docker exec -i elclub-pre-galaxy-1 node dist/cli.js check-config -"
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir || !statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
  process.stderr.write('Uso: node scripts/ops-bundle.mjs <carpeta de ops/launch>\n');
  process.exit(1);
}
const bundle = {};
for (const file of readdirSync(dir).sort()) {
  if (!file.endsWith('.json')) continue;
  // A BOM (files saved from PowerShell) would break JSON.parse here and on the server.
  const text = readFileSync(join(dir, file), 'utf8');
  bundle[file.slice(0, -'.json'.length)] = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}
process.stdout.write(JSON.stringify(bundle));
