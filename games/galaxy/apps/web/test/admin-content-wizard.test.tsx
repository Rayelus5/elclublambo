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
    'GET /galaxy/api/admin/config/sectors': () => jsonResponse(200, { key: 'sectors', version: 2, data: parseConfig('sectors', {}), createdAt: null, author: null, note: null }),
    'GET /galaxy/api/admin/config/probes': () => jsonResponse(200, { key: 'probes', version: 2, data: parseConfig('probes', {}), createdAt: null, author: null, note: null }),
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

const putsOf = (fetch: ReturnType<typeof mockApi>, key: string) =>
  fetch.mock.calls
    .filter(([u, init]) => u === '/galaxy/api/admin/config-drafts/d1/field' && init?.method === 'PUT')
    .map(([, init]) => JSON.parse(String(init!.body)) as { key: string; field: string; value: unknown })
    .filter((p) => p.key === key);
const stepTo = async (user: ReturnType<typeof userEvent.setup>, name: string) => user.click(within(screen.getByRole('tablist', { name: w.steps })).getByRole('tab', { name: new RegExp(name) }));

test('un sector nuevo entra antes del de temporada, con su desbloqueo y su paga en el mismo borrador', async () => {
  const fetch = open('sector');
  const user = userEvent.setup();
  const rings = live.sectors.find((s) => s.id === 'frost-rings')!;
  fireEvent.change(await screen.findByRole('textbox', { name: w.name }), { target: { value: 'Cinturón de prueba' } });
  await pickOption(user, screen.getByRole('combobox', { name: w.basedOn }), rings.name);
  await stepTo(user, w.unlock);
  await pickOption(user, screen.getByRole('combobox', { name: w.unlockAfter }), live.sectors.find((s) => s.id === 'broken-forge')!.name);
  fireEvent.change(screen.getByRole('spinbutton', { name: w.pay }), { target: { value: '1.6' } });
  await stepTo(user, w.review);
  await user.click(screen.getByRole('button', { name: w.add }));
  await waitFor(() => expect(putsOf(fetch, 'sectors').map((p) => p.field)).toEqual(expect.arrayContaining(['unlocks', 'pay'])), { timeout: 3000 });
  await waitFor(() => expect(putsOf(fetch, 'content').map((p) => p.field)).toContain('sectors'), { timeout: 3000 });
  const sectors = putsOf(fetch, 'content').find((p) => p.field === 'sectors')!.value as { id: string; season: boolean }[];
  const at = sectors.findIndex((s) => s.id === 'cinturon-de-prueba');
  expect(at).toBe(sectors.findIndex((s) => s.season) - 1);
  const unlocks = putsOf(fetch, 'sectors').find((p) => p.field === 'unlocks')!.value as Record<string, { sector: string }>;
  expect(unlocks['cinturon-de-prueba']).toEqual({ sector: 'broken-forge', stat: 'bossKills', value: 1 });
  expect(unlocks['frost-rings']).toBeDefined();
  expect((putsOf(fetch, 'sectors').find((p) => p.field === 'pay')!.value as Record<string, number>)['cinturon-de-prueba']).toBe(1.6);
});

test('un Núcleo nuevo sale como forma de los sectores que se eligen', async () => {
  const fetch = open('nucleo');
  const user = userEvent.setup();
  const glacier = live.bosses.find((b) => b.id === 'glacier')!;
  fireEvent.change(await screen.findByRole('textbox', { name: w.name }), { target: { value: 'La Escarcha Nueva' } });
  await pickOption(user, screen.getByRole('combobox', { name: w.basedOn }), glacier.name);
  await stepTo(user, w.placement);
  await user.click(screen.getByRole('checkbox', { name: live.sectors.find((s) => s.id === 'frost-rings')!.name }));
  await stepTo(user, w.review);
  await user.click(screen.getByRole('button', { name: w.add }));
  await waitFor(() => expect(putsOf(fetch, 'content').map((p) => p.field)).toEqual(expect.arrayContaining(['bosses', 'sectors'])), { timeout: 3000 });
  const sectors = putsOf(fetch, 'content').find((p) => p.field === 'sectors')!.value as { id: string; boss: string; bossCycle?: string[] }[];
  const rings = sectors.find((s) => s.id === 'frost-rings')!;
  expect(rings.bossCycle?.[0]).toBe(rings.boss);
  expect(rings.bossCycle).toContain('la-escarcha-nueva');
});

test('un arma nueva no se añade sin su evolución, y con ella entran las dos', async () => {
  const fetch = open('arma');
  const user = userEvent.setup();
  const pulse = live.weapons.find((x) => x.id === 'pulse')!;
  fireEvent.change(await screen.findByRole('textbox', { name: w.name }), { target: { value: 'Pulso doble' } });
  await pickOption(user, screen.getByRole('combobox', { name: w.basedOn }), pulse.name);
  await stepTo(user, w.review);
  expect(screen.getByText(w.needsEvolution)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: w.add })).toBeDisabled();
  await stepTo(user, w.evolution);
  fireEvent.change(screen.getByRole('textbox', { name: w.evolutionName }), { target: { value: 'Pulso doble máximo' } });
  await pickOption(user, screen.getByRole('combobox', { name: w.evolutionNeeds }), live.passives[0]!.name);
  await stepTo(user, w.review);
  await user.click(screen.getByRole('button', { name: w.add }));
  await waitFor(() => expect(putsOf(fetch, 'content').map((p) => p.field)).toContain('weapons'), { timeout: 3000 });
  const weapons = putsOf(fetch, 'content').find((p) => p.field === 'weapons')!.value as { id: string; levels: unknown[]; evolution?: { from: string; requires: { passive?: string } } }[];
  const evo = weapons.find((x) => x.evolution?.from === 'pulso-doble')!;
  expect(evo.id).toBe('pulso-doble-maximo');
  expect(evo.levels).toHaveLength(1);
  expect(evo.evolution!.requires).toEqual({ passive: live.passives[0]!.id });
  expect(weapons.find((x) => x.id === 'pulso-doble')!.evolution).toBeFalsy();
});

test('una sonda nueva entra con su condición de desbloqueo', async () => {
  const fetch = open('sonda');
  const user = userEvent.setup();
  fireEvent.change(await screen.findByRole('textbox', { name: w.name }), { target: { value: 'Faro' } });
  await pickOption(user, screen.getByRole('combobox', { name: w.basedOn }), live.probes[0]!.name);
  await stepTo(user, w.unlock);
  fireEvent.change(screen.getByRole('spinbutton', { name: w.unlockValue }), { target: { value: '7' } });
  await stepTo(user, w.review);
  await user.click(screen.getByRole('button', { name: w.add }));
  await waitFor(() => expect(putsOf(fetch, 'probes').map((p) => p.field)).toContain('unlocks'), { timeout: 3000 });
  await waitFor(() => expect(putsOf(fetch, 'content').map((p) => p.field)).toContain('probes'), { timeout: 3000 });
  const unlocks = putsOf(fetch, 'probes').find((p) => p.field === 'unlocks')!.value as Record<string, { stat: string; value: number }>;
  expect(unlocks['faro']).toEqual({ stat: 'runs', value: 7 });
  expect(putsOf(fetch, 'content').find((p) => p.field === 'probes')).toBeDefined();
});
