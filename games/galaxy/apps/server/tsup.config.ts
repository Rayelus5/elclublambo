import { defineConfig } from 'tsup';

// dist/main.js (server), dist/cli.js (container CLI) and dist/replay-worker.js (the tournaments' review replays runs in
// a worker thread started from next to the bundle: src/tournaments/replayer.ts). @galaxy/shared and @galaxy/engine are bundled from source
// (with the engine's @noble/hashes, a dependency the server does not declare); other npm dependencies stay
// external and are installed in the image by the `prod-deps` stage (pnpm install --prod from the lockfile).
export default defineConfig({
  entry: { main: 'src/main.ts', cli: 'src/bin/cli.ts', 'replay-worker': 'src/tournaments/replay-worker.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@galaxy\//, /^@noble\//],
});
