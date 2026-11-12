import type { CodexProgress } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { CodexScreen } from '../src/codex/CodexScreen';
import { codexEntries } from '../src/codex/entries';
import { copy } from '../src/copy/es';
import { jsonResponse, mockApi, renderAt } from './render';

// The Códice (GDD §15; M7b-2): entries open by playing; a locked one says how it opens.
afterEach(() => vi.unstubAllGlobals());
const fresh: CodexProgress = { sectors: {}, bossKills: 0, maxDepth: 0, level: 1 };

test('una especie se abre al aguantar en su sector hasta que aparece, y su Núcleo al purgarlo', () => {
  const e = codexEntries();
  const mite = e.find((x) => x.id === 'beast-mite')!;
  const shell = e.find((x) => x.id === 'beast-shell')!;
  const hive = e.find((x) => x.id === 'core-hive')!;
  const played = { ...fresh, sectors: { 'outer-nebula': { maxSeconds: 30, bossKills: 0 } } };
  expect(mite.open(played)).toBe(true);
  expect(shell.open(played)).toBe(false);
  expect(hive.open(played)).toBe(false);
  expect(hive.open({ ...played, sectors: { 'outer-nebula': { maxSeconds: 400, bossKills: 1 } } })).toBe(true);
  expect(mite.fight).toBeTruthy();
});

test('la crónica abre lo de nivel 1 y lo demás dice cómo se abre', async () => {
  mockApi({ 'GET /galaxy/api/codex': () => jsonResponse(200, fresh) });
  renderAt('/codice', { '/codice': <CodexScreen /> });
  expect(await screen.findByRole('heading', { name: 'Premisa' })).toBeInTheDocument();
  const locked = screen.getAllByRole('button', { name: copy.codex.locked });
  await userEvent.click(locked[0]!);
  expect(screen.getByText(/Se abre con el nivel/)).toBeInTheDocument();
});

// Nov plan B4: every Core shows its three forms. A sector's later form opens once a run there purged the layer it first
// comes in; the deep Core's, by reaching its layer (like the first one, at layer 4).
test('el Códice muestra las tres formas de cada Núcleo y oculta las que aún no has purgado', () => {
  const cores = codexEntries().filter((x) => x.section === 'cores');
  expect(cores).toHaveLength(18);
  expect(cores.slice(0, 3).map((x) => x.id)).toEqual(['core-hive', 'core-hive-swarm', 'core-hive-queen']);
  for (const c of cores) expect(c.text, c.id).not.toBe('');
  const at = (id: string) => cores.find((x) => x.id === id)!;
  const nebula = (maxBossKills: number) => ({ ...fresh, sectors: { 'outer-nebula': { maxSeconds: 900, bossKills: 9, maxBossKills } } });
  expect(at('core-hive').open(nebula(1))).toBe(true);
  expect(at('core-hive-swarm').open(nebula(1))).toBe(false);
  expect(at('core-hive-swarm').open(nebula(2))).toBe(true);
  expect(at('core-hive-queen').open(nebula(2))).toBe(false);
  expect(at('core-hive-queen').open(nebula(3))).toBe(true);
  expect(at('core-hive-swarm').hint).toMatch(/capa 2 de Nebulosa Exterior/);
  // An older answer of the server, without the deepest purge, keeps them hidden.
  expect(at('core-hive-swarm').open({ ...fresh, sectors: { 'outer-nebula': { maxSeconds: 900, bossKills: 9 } } })).toBe(false);
  // The season sector has no deep Core: its forms come at layers 2 and 3 too.
  expect(at('core-signal-answer').open({ ...fresh, sectors: { 'signal-rift': { maxSeconds: 900, bossKills: 3, maxBossKills: 3 } } })).toBe(true);
  // The deep Core: layer 4, then 8, then 12 of any sector.
  expect(at('core-echo-core').open({ ...fresh, maxDepth: 4 })).toBe(true);
  expect(at('core-echo-choir').open({ ...fresh, maxDepth: 7 })).toBe(false);
  expect(at('core-echo-choir').open({ ...fresh, maxDepth: 8 })).toBe(true);
  expect(at('core-echo-mirror').open({ ...fresh, maxDepth: 12 })).toBe(true);
  expect(at('core-echo-mirror').hint).toMatch(/capa 12/);
  // The new forms say how to face their new attack.
  for (const id of ['core-hive-swarm', 'core-glacier-egg', 'core-anvil-hammer']) expect(at(id).fight, id).toBeTruthy();
});

test('PERKINS tiene una frase para cada forma nueva de Núcleo', () => {
  for (const b of DEFAULT_CONTENT.bosses) if (b.id !== 'hive') expect(copy.arena.radio.bosses[b.id], b.id).toMatch(/^PERKINS: /);
});
