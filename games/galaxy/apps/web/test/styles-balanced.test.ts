import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// The stylesheet parses (mail v2, 2026-11-16): a merge once dropped a block's closing brace, and only the browser tests
// (which load the CSS) noticed. Every block opened is closed, outside comments and strings.
test('app.css cierra cada bloque que abre', () => {
  const css = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
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
