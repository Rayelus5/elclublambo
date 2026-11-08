import type { RedshiftView } from '@galaxy/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { Redshift } from '../src/lab/Redshift';
import { jsonResponse, mockApi, renderAt } from './render';

// The prestige «Corrimiento al rojo» (GDD §12.5; M7e-2): what it asks, and taking it after saying what restarts.
afterEach(() => vi.unstubAllGlobals());
const t = copy.redshift;
const ready: RedshiftView = { rank: 0, maxRank: 5, minLevel: 25, level: 26, labLevels: 12, needed: 10, eligible: true, bonus: { xp: 0, luck: 0 }, next: { xp: 0.03, luck: 0.02, title: 'Corrimiento I' } };

test('con todo cumplido se puede hacer el corrimiento, tras un aviso de lo que vuelve a cero y lo que se queda', async () => {
  const fetch = mockApi({ 'GET /galaxy/api/redshift': () => jsonResponse(200, ready), 'POST /galaxy/api/redshift': () => jsonResponse(200, { ...ready, rank: 1, labLevels: 0, needed: 15, eligible: false }) });
  renderAt('/', { '/': <Redshift /> });
  expect(await screen.findByText(t.needLab(10, 12))).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: t.take }));
  expect(await screen.findByRole('alertdialog', { name: t.confirmTitle })).toHaveTextContent(t.confirmKeeps);
  await userEvent.click(screen.getByRole('button', { name: t.confirm }));
  await vi.waitFor(() => expect(fetch.mock.calls.some(([url, init]) => url === '/galaxy/api/redshift' && init?.method === 'POST')).toBe(true));
  expect(await screen.findByText(t.rank(1, 5))).toBeInTheDocument();
});

test('por debajo de su nivel y sin rango no se enseña', async () => {
  const fetch = mockApi({ 'GET /galaxy/api/redshift': () => jsonResponse(200, { ...ready, level: 10, eligible: false }) });
  renderAt('/', { '/': <Redshift /> });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(screen.queryByRole('heading', { name: t.title })).toBeNull();
});
