import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { vi } from 'vitest';

/** Shows where the router ended up, so tests can assert navigation (path, query and state). */
export function LocationProbe() {
  const loc = useLocation();
  return <pre data-testid="location">{JSON.stringify({ pathname: loc.pathname, search: loc.search, state: loc.state })}</pre>;
}

export function renderAt(path: string, routes: Record<string, ReactElement>, state?: unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: path.split('?')[0]!, search: path.includes('?') ? `?${path.split('?')[1]}` : '', state }]}>
        <Routes>
          {Object.entries(routes).map(([p, el]) => (
            <Route key={p} path={p} element={el} />
          ))}
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // The cache too, for tests that seed or read it.
  return Object.assign(view, { client });
}

export function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
  });
}

/** Replaces fetch with a router of `METHOD path` → response; unmatched calls fail the test loudly. */
export function mockApi(routes: Record<string, (body: unknown) => Response>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    const handler = routes[key];
    if (!handler) throw new Error(`unexpected fetch ${key}`);
    return handler(init?.body ? JSON.parse(String(init.body)) : undefined);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function locationOf(el: HTMLElement): { pathname: string; search: string; state: unknown } {
  return JSON.parse(el.textContent ?? '{}');
}
