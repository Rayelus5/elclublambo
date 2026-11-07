import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { App } from '../../src/App';

// Onboarding in a real browser, with the app's routes and guards (GDD §12.2). jsdom's act() flushes the router's
// transitions with everything else and hides the race this pins: the session lands in the cache, the guest-only guard
// of /crear-cuenta re-renders first and sends the new account home instead of to the probe test.

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('crear la cuenta lleva al test de la sonda y se queda allí', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${url}`;
      if (key === 'GET /galaxy/api/auth/me') return json(401, { error: 'unauthorized' });
      if (key === 'POST /galaxy/api/auth/register') return json(201, { id: '1', username: 'piloto_0123', roles: [], mfa: false });
      // The home screen's own calls (wallet, collection): an empty answer is enough here.
      return json(404, { error: 'not_found' });
    }),
  );
  await page.viewport(1440, 900);
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root.render(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, { initialEntries: ['/crear-cuenta'] }, createElement(App))));

  await page.getByLabelText('Usuario').fill('piloto_0123');
  await page.getByLabelText('Contraseña', { exact: true }).fill('una-clave-larga');
  await page.getByLabelText('Repite la contraseña').fill('una-clave-larga');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();

  await vi.waitFor(() => expect(document.querySelector('.probe-test')).not.toBeNull(), { timeout: 5000 });
  // And it stays: no late redirect home.
  await new Promise((r) => setTimeout(r, 500));
  expect(document.querySelector('.probe-test')).not.toBeNull();
}, 30_000);
