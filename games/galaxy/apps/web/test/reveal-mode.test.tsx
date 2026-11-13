import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { useRevealMode } from '../src/scanner/useRevealMode';
import { jsonResponse, mockApi } from './render';

// The owner: the tutorial's first scan shows the pro presentation too, when the browser can play it.
vi.mock('../src/ui/webgl', () => ({ hasWebGL2: () => true }));
afterEach(() => vi.unstubAllGlobals());

test('con el tutorial en el escáner también se ve la presentación pro', async () => {
  mockApi({ 'GET /galaxy/api/tutorial': () => jsonResponse(200, { status: 'active', chapter: 'scanner', gift: 0 }) });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  // The tutorial on the scanner, as the rest of the game has it (the old rule read it from here and chose the classic).
  qc.setQueryData(['tutorial'], { status: 'active', chapter: 'scanner', gift: 0 });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useRevealMode(), { wrapper });
  await waitFor(() => expect(result.current).toBe('pro'));
});
