import { screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { BoostChips } from '../src/hub/Boosts';
import { copy } from '../src/copy/es';
import { jsonResponse, mockApi, renderAt } from './render';

// The global multipliers running now (GDD §16.3; M6d-5): a chip each with its factor and its end; nothing without any.
afterEach(() => vi.unstubAllGlobals());

test('cada multiplicador en marcha sale con su moneda, su factor y cuándo acaba', async () => {
  mockApi({ 'GET /galaxy/api/boosts': () => jsonResponse(200, { boosts: [{ id: 'polvo', name: 'Doble polvo', currency: 'dust', factor: 2, endsAt: '2026-11-15T22:59:00.000Z' }] }) });
  renderAt('/', { '/': <BoostChips /> });
  const list = await screen.findByRole('list', { name: copy.boosts.title });
  expect(list).toHaveTextContent(/Doble polvo, polvo x2 hasta el domingo/);
});

test('sin multiplicadores no sale nada', async () => {
  const fetch = mockApi({ 'GET /galaxy/api/boosts': () => jsonResponse(200, { boosts: [] }) });
  renderAt('/', { '/': <BoostChips /> });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(screen.queryByRole('list', { name: copy.boosts.title })).toBeNull();
});
