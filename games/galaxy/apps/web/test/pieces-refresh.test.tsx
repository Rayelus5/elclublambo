import type { ShopPurchaseView } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { COSMETICS_KEY } from '../src/api/cosmetics';
import { HANGAR_KEY } from '../src/api/runs';
import { onPurchaseDelivered, usePurchase } from '../src/api/shop';
import { jsonResponse, mockApi } from './render';

// The owner: «cuando un usuario compra por ejemplo una skin de una sonda que ya tiene equipada, debe refrescar la
// página para que le salga». A delivered purchase (read by its poll or told by the live socket) refreshes what shows
// the pieces a player has: the Hangar (each probe's skins) and «Personalizar», not only the wallet and the shop.
afterEach(() => vi.unstubAllGlobals());

const purchase: ShopPurchaseView = {
  id: '00000000-0000-4000-8000-0000000000bb',
  product: 'style-skin-lumen',
  name: 'Lumen leyenda',
  status: 'paid',
  amountCents: 399,
  grants: { coins: 0, dust: 0, components: 0 },
  createdAt: '2026-11-13T00:00:00.000Z',
  paidAt: '2026-11-13T00:00:10.000Z',
  wallet: { coins: 0, dust: 0, signal: 0, components: 0 },
};

function client() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(HANGAR_KEY, { probes: [] });
  qc.setQueryData(COSMETICS_KEY, { owned: { skins: [] } });
  return qc;
}
const invalid = (qc: QueryClient, key: readonly string[]) => qc.getQueryState(key)?.isInvalidated ?? false;

test('una compra entregada por el aviso en vivo refresca el Hangar y Personalizar', () => {
  const qc = client();
  onPurchaseDelivered(qc, purchase);
  expect(invalid(qc, HANGAR_KEY)).toBe(true);
  expect(invalid(qc, COSMETICS_KEY)).toBe(true);
});

test('una compra que se lee pagada también los refresca', async () => {
  mockApi({ [`GET /galaxy/api/shop/purchases/${purchase.id}`]: () => jsonResponse(200, purchase) });
  const qc = client();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  renderHook(() => usePurchase(purchase.id), { wrapper });
  await waitFor(() => expect(invalid(qc, HANGAR_KEY)).toBe(true));
  expect(invalid(qc, COSMETICS_KEY)).toBe(true);
});
