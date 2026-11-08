import { parseConfig } from '@galaxy/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { EconomySimulator } from '../src/admin/EconomySimulator';
import { copy } from '../src/copy/es';
import { jsonResponse, mockApi, renderAt } from './render';

// The economy simulator (GDD §16.6; M6d-5): bot runs, then the live config against the draft. Nothing is sent.
afterEach(() => vi.unstubAllGlobals());
const t = copy.admin.economy;

test('el simulador compara lo publicado y el borrador y lo dice como estimación', async () => {
  const fetch = mockApi({ 'GET /galaxy/api/admin/config/keys': () => jsonResponse(200, [{ key: 'runs', version: 3, data: parseConfig('runs', {}), createdAt: null, createdBy: null, note: null }]) });
  const draft = { ...parseConfig('runs', {}), deathShare: 0.9 } as unknown as Record<string, unknown>;
  renderAt('/', { '/': <EconomySimulator editing="runs" draft={draft} lengths={[0.25]} /> });
  const user = userEvent.setup();
  const run = await screen.findByRole('button', { name: t.run });
  await vi.waitFor(() => expect(run).toBeEnabled());
  await user.click(run);
  const table = await screen.findByRole('table', { name: t.tableTitle }, { timeout: 20_000 });
  expect(screen.getByText(/Estimación con 3 partidas del bot/)).toBeInTheDocument();
  // The bot's runs die early: a bigger death share pays more coins per run in the draft.
  const coins = within(table).getByRole('rowheader', { name: t.perRun('monedas') }).closest('tr')!;
  const [live, draftCell] = within(coins).getAllByRole('cell');
  expect(Number(draftCell!.textContent!.replace(/\D/g, ''))).toBeGreaterThanOrEqual(Number(live!.textContent!.replace(/\D/g, '')));
  expect(fetch.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true);
}, 30_000);
