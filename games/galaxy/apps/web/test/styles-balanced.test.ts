import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

// The stylesheet parses (mail v2, 2026-11-16): a merge once dropped a block's closing brace, and only the browser tests
// (which load the CSS) noticed. Every block opened is closed (comments aside).
test('app.css cierra cada bloque que abre', () => {
  const css = readFileSync(resolve(process.cwd(), 'apps/web/src/styles/app.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0;
  let lowest = 0;
  for (const ch of css) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    lowest = Math.min(lowest, depth);
  }
  expect(lowest).toBe(0);
  expect(depth).toBe(0);
});
