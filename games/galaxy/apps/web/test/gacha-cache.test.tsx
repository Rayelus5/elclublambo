import type { GachaView, PullResponse } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { GACHA_KEY, usePull } from '../src/api/economy';
import { jsonResponse, mockApi } from './render';

// The wallet view every screen reads (`GET /gacha`) carries what only it knows: the shop's flag (the home's «Tienda»
// pill) and the event leftovers. A scan answers with a narrower view, so it must not wipe those out of the cache: the
// owner saw «Tienda» vanish from the home after scanning, until a reload (2026-11-22).
afterEach(() => vi.unstubAllGlobals());

const base: GachaView = { banners: [], costs: { coins: 100, coinsFive: 475, coinsTen: 900, signals: 1 }, freePullAvailable: true, wallet: { coins: 500, dust: 0, signal: 3 } };

test('escanear no borra de la vista guardada la tienda ni lo que solo trae GET /gacha', async () => {
  const after: PullResponse = { pulls: [], wallet: { coins: 400, dust: 0, signal: 3 }, view: { ...base, freePullAvailable: false } };
  mockApi({ 'POST /galaxy/api/gacha/pull': () => jsonResponse(200, after) });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  qc.setQueryData<GachaView>(GACHA_KEY, { ...base, shop: { open: true, offer: true } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => usePull(), { wrapper });
  await act(() => result.current.mutateAsync({ banner: 'deep-scan', count: 1, pay: 'coins' }));
  const cached = qc.getQueryData<GachaView>(GACHA_KEY)!;
  expect(cached.shop).toEqual({ open: true, offer: true });
  // What the scan does know replaces the old: the wallet and the free scan.
  expect(cached.wallet).toEqual({ coins: 400, dust: 0, signal: 3 });
  expect(cached.freePullAvailable).toBe(false);
});
