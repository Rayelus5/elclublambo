import type { CodexProgress } from '@galaxy/shared';
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
