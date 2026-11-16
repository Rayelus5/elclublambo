import { type DraftView, type MeResponse, parseConfig } from '@galaxy/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { ContentScreen } from '../src/admin/content/ContentScreen';
import { copy } from '../src/copy/es';
import { jsonResponse, mockApi, renderAt } from './render';
import { pickOption } from './pick';

// The «Crear…» wizards (the content editor, 2026-11-16, P9a): a new enemy, passive, reaction, anomaly or relic set in
// steps — its name and what it is based on, one step per section of its fields, where an enemy comes out, and a review
// with its problems — added to the draft (never published from here).
afterEach(() => vi.unstubAllGlobals());

const t = copy.admin.content;
const w = t.wizard;
const admin: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };
const live = parseConfig('content', {});
const draft = (over: Partial<DraftView> = {}): DraftView => ({
  id: 'd1',
  title: 'Asistentes',
  status: 'open',
  revision: 1,
  fields: [],
  createdBy: 'rayelus',
  updatedBy: 'rayelus',
  createdAt: '2026-11-16T10:00:00.000Z',
  updatedAt: '2026-11-16T10:00:00.000Z',
  stale: false,
  data: {},
  baseVersions: {},
  publishedVersions: null,
  ...over,
});
function open(kind: string) {
  const fetch = mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, admin),
    'GET /galaxy/api/admin/config/content': () => jsonResponse(200, { key: 'content', version: 4, data: live, createdAt: null, author: null, note: null }),
    'GET /galaxy/api/admin/config/content/versions': () => jsonResponse(200, []),
    'GET /galaxy/api/admin/config-drafts/d1': () => jsonResponse(200, draft()),
    'PUT /galaxy/api/admin/config-drafts/d1/field': () => jsonResponse(200, draft({ revision: 2 })),
  });
  renderAt(`/admin/configuracion/content?borrador=d1&crear=${kind}`, { '/admin/configuracion/content': <ContentScreen /> });
  return fetch;
}
const puts = (fetch: ReturnType<typeof mockApi>) =>
  fetch.mock.calls.filter(([u, init]) => u === '/galaxy/api/admin/config-drafts/d1/field' && init?.method === 'PUT').map(([, init]) => JSON.parse(String(init!.body)) as { field: string; value: unknown });
const mite = live.enemies.find((e) => e.id === 'mite')!;
const nebula = live.sectors[0]!;

test('un enemigo nuevo basado en otro, con su sitio en un sector, entra en el borrador', async () => {
  const fetch = open('enemigo');
  const user = userEvent.setup();
  expect(await screen.findByRole('heading', { name: w.title.enemy })).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: w.name }), { target: { value: 'Ácaro de prueba' } });
  await pickOption(user, screen.getByRole('combobox', { name: w.basedOn }), mite.name);
  const steps = screen.getByRole('tablist', { name: w.steps });
  await user.click(within(steps).getByRole('tab', { name: new RegExp(w.placement) }));
  // Where its model comes out, it comes out too: a starting point.
  expect(screen.getByRole('checkbox', { name: nebula.name })).toBeChecked();
  await user.click(within(steps).getByRole('tab', { name: new RegExp(w.review) }));
  await user.click(screen.getByRole('button', { name: w.add }));
  expect(await screen.findByRole('heading', { name: 'Ácaro de prueba' })).toBeInTheDocument();
  await waitFor(() => expect(puts(fetch).map((p) => p.field)).toEqual(expect.arrayContaining(['enemies', 'sectors'])), { timeout: 3000 });
  const enemies = puts(fetch).find((p) => p.field === 'enemies')!.value as { id: string; hp: number }[];
  expect(enemies.find((e) => e.id === 'acaro-de-prueba')!.hp).toBe(mite.hp);
  const sectors = puts(fetch).find((p) => p.field === 'sectors')!.value as { id: string; spawns: { enemy: string }[] }[];
  expect(sectors.find((s) => s.id === nebula.id)!.spawns.some((sp) => sp.enemy === 'acaro-de-prueba')).toBe(true);
});

test('un enemigo que no sale en ningún sitio no se añade, y dice por qué', async () => {
  open('enemigo');
  const user = userEvent.setup();
  fireEvent.change(await screen.findByRole('textbox', { name: w.name }), { target: { value: 'Solitario' } });
  await user.click(within(screen.getByRole('tablist', { name: w.steps })).getByRole('tab', { name: new RegExp(w.review) }));
  expect(screen.getByRole('button', { name: w.add })).toBeDisabled();
  expect(screen.getByText(w.needsPlacement)).toBeInTheDocument();
  // From scratch it still needs its look and numbers; placed in a sector, that is what is left to fix.
  await user.click(within(screen.getByRole('tablist', { name: w.steps })).getByRole('tab', { name: new RegExp(w.placement) }));
  await user.click(screen.getByRole('checkbox', { name: nebula.name }));
  await user.click(within(screen.getByRole('tablist', { name: w.steps })).getByRole('tab', { name: new RegExp(w.review) }));
  expect(screen.queryByText(w.needsPlacement)).toBeNull();
});

test('una reacción copiada de otra avisa de que esa pareja ya reacciona', async () => {
  open('reaccion');
  const user = userEvent.setup();
  const first = live.elements.reactions[0]!;
  fireEvent.change(await screen.findByRole('textbox', { name: w.name }), { target: { value: 'Reacción nueva' } });
  await pickOption(user, screen.getByRole('combobox', { name: w.basedOn }), first.name);
  await user.click(within(screen.getByRole('tablist', { name: w.steps })).getByRole('tab', { name: new RegExp(w.review) }));
  expect(screen.getByText(/cada pareja solo puede tener una reacción/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: w.add })).toBeDisabled();
});

test('cada asistente se abre desde el editor y se cierra sin tocar el borrador', async () => {
  const fetch = open('pasiva');
  const user = userEvent.setup();
  expect(await screen.findByRole('heading', { name: w.title.passive })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: w.cancel }));
  expect(await screen.findByRole('tablist', { name: t.areas })).toBeInTheDocument();
  expect(puts(fetch)).toEqual([]);
});
