import type { BoostsView } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { HangarScreen } from '../src/hangar/HangarScreen';
import { view } from './hangar-fixtures';
import { jsonResponse, mockApi, renderAt } from './render';

// Condiciones de hoy (open beta): in /incursion the day's yield, the season's anomaly and the multipliers running now
// no longer sit as sentences over Lanzar. A button there carries small signs (full-yield hours, the best factor, an
// alert for the anomaly) and opens them in a window when the player wants.

vi.mock('../src/arena/ArenaScreen', () => ({ ArenaScreen: () => null, default: () => null }));
beforeEach(() => localStorage.clear());

const t = copy.today;
const anomaly = { id: 'contagion', name: 'Corrosión contagiosa', description: 'Un enemigo corroído que cae corroe a los que tiene cerca' };
const launch: BoostsView = {
  boosts: [
    { id: 'b1', name: 'Lanzamiento de la Beta Abierta', currency: 'coins', factor: 1.5, endsAt: '2026-11-16T23:00:00.000Z' },
    { id: 'b2', name: 'Lanzamiento de la Beta Abierta', currency: 'dust', factor: 1.5, endsAt: '2026-11-16T23:00:00.000Z' },
  ],
  anomaly,
};

function api(boosts: BoostsView, hangar = view()) {
  return mockApi({
    'GET /galaxy/api/hangar': () => jsonResponse(200, hangar),
    'GET /galaxy/api/boosts': () => jsonResponse(200, boosts),
  });
}

test('el premio del día, la anomalía y los multiplicadores esperan en Condiciones de hoy, con iconos pequeños en su botón', async () => {
  api(launch);
  renderAt('/incursion', { '/incursion': <HangarScreen /> });
  const button = await screen.findByRole('button', { name: new RegExp(t.button) });
  await waitFor(() => expect(button).toHaveTextContent(t.boostChip(1.5)));
  expect(button).toHaveTextContent(t.dailyChip(3 * 3600));
  expect(button.querySelector('.today-anomaly')).not.toBeNull();
  // Nothing of it is written out over Lanzar.
  expect(screen.queryByText(copy.hangar.dailyFull('3 h 0 min'))).toBeNull();
  expect(screen.queryByText(copy.anomaly.tag(anomaly.name))).toBeNull();
  expect(screen.queryByText('Lanzamiento de la Beta Abierta')).toBeNull();
  await userEvent.click(button);
  const dialog = await screen.findByRole('dialog', { name: t.title });
  const daily = within(dialog).getByRole('region', { name: t.daily });
  expect(daily).toHaveTextContent(copy.hangar.dailyFull('3 h 0 min'));
  expect(daily).toHaveTextContent(copy.hangar.dailyHint(3));
  const season = within(dialog).getByRole('region', { name: t.anomaly });
  expect(season).toHaveTextContent(anomaly.name);
  expect(season).toHaveTextContent(anomaly.description);
  const multipliers = within(dialog).getByRole('region', { name: t.boosts });
  const card = within(multipliers).getByText('Lanzamiento de la Beta Abierta').closest('li')!;
  expect(card).toHaveTextContent(copy.news.rate('coins', 1.5));
  expect(card).toHaveTextContent(copy.news.rate('dust', 1.5));
  await userEvent.click(within(dialog).getByRole('button', { name: t.close }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('con el premio ya rebajado y sin anomalía ni multiplicadores, el botón solo dice el porcentaje y la ventana solo el premio', async () => {
  api({ boosts: [], anomaly: null }, view({ daily: { playedSeconds: 4 * 3600, fullSecondsLeft: 0, multiplier: 0.75, fullHours: 3, resetsAt: '2026-11-07T23:00:00.000Z' } }));
  renderAt('/incursion', { '/incursion': <HangarScreen /> });
  const button = await screen.findByRole('button', { name: new RegExp(t.button) });
  expect(button).toHaveTextContent(t.cutChip(75));
  expect(button).not.toHaveTextContent('×');
  expect(button.querySelector('.today-anomaly')).toBeNull();
  await userEvent.click(button);
  const dialog = await screen.findByRole('dialog', { name: t.title });
  expect(within(dialog).getByRole('region', { name: t.daily })).toHaveTextContent(copy.hangar.dailyTier(75));
  expect(within(dialog).queryByRole('region', { name: t.anomaly })).toBeNull();
  expect(within(dialog).queryByRole('region', { name: t.boosts })).toBeNull();
});
