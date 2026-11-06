import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ApiError, api } from '../src/api/client';
import { useUi } from '../src/state/ui';
import { jsonResponse } from './render';

beforeEach(() => useUi.setState({ maintenance: false }));
afterEach(() => vi.unstubAllGlobals());

test('GET contra /galaxy/api con credenciales del mismo origen y devuelve el JSON', async () => {
  const fetch = vi.fn(async () => jsonResponse(200, { ok: true }));
  vi.stubGlobal('fetch', fetch);
  await expect(api('/auth/me')).resolves.toEqual({ ok: true });
  expect(fetch).toHaveBeenCalledWith('/galaxy/api/auth/me', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }));
});

test('POST manda el cuerpo como JSON', async () => {
  const fetch = vi.fn(async () => jsonResponse(201, { id: 'x' }));
  vi.stubGlobal('fetch', fetch);
  await api('/auth/register', { method: 'POST', body: { username: 'a', password: 'b' } });
  const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(init.method).toBe('POST');
  expect(JSON.parse(String(init.body))).toEqual({ username: 'a', password: 'b' });
  expect(new Headers(init.headers).get('content-type')).toBe('application/json');
});

test('un 401 lanza ApiError con code unauthenticated', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { error: 'unauthenticated' })));
  const err = await api('/auth/me').catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({ code: 'unauthenticated', status: 401 });
});

test('un 503 maintenance activa el modo mantenimiento del store', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(503, { error: 'maintenance' })));
  await expect(api('/auth/register', { method: 'POST', body: {} })).rejects.toMatchObject({ code: 'maintenance' });
  expect(useUi.getState().maintenance).toBe(true);
});

test('un 204 devuelve undefined', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(204)));
  await expect(api('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
});

test('red caída o respuesta sin código conocido → ApiError internal', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
  await expect(api('/auth/me')).rejects.toMatchObject({ code: 'internal', status: 0 });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>502</html>', { status: 502 })));
  await expect(api('/auth/me')).rejects.toMatchObject({ code: 'internal', status: 502 });
});
