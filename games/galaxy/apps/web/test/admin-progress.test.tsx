import type { AdminPlayer, AdminProgress, MeResponse } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { PlayerScreen } from '../src/admin/PlayerScreen';
import { copy } from '../src/copy/es';
import { jsonResponse, mockApi, renderAt } from './render';
import { pickOption } from './pick';

// The «Progreso» tab of a player's page (GDD §16.2; M6d-4): the gacha luck, the probes, the station's machines, the
// Laboratorio and the season, each with its change. Raising asks only for a reason; taking away also the password.
afterEach(() => vi.unstubAllGlobals());

const t = copy.admin;
const g = t.progress;
const admin: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };
const player: AdminPlayer = {
  id: 'p1',
  username: 'vega',
  createdAt: '2026-11-01T10:00:00.000Z',
  deletedAt: null,
  roles: [],
  level: 12,
  xp: 15000,
  banned: null,
  muted: null,
  leaderboardExcluded: false,
  clan: null,
  wallet: { coins: 0, dust: 0, signal: 0, material: 0, components: 0 },
  counts: { galaxies: 0, runs: 0, pulls: 0, listings: 0, trades: 0, messages: 0 },
  sessions: [],
  ips: [],
  station: [],
  lab: [],
  probes: [],
};
const progress: AdminProgress = {
  gacha: [{ group: 'standard', sinceLegendary: 7, sinceFeatured: 0, welcome: true, totalPulls: 12 }],
  probes: [
    { probe: 'lumen', name: 'Lumen', level: 4, maxLevel: 10, variant: null, variants: [{ id: 'pulse-wide', name: 'Pulso ancho', unlockAt: 4 }], unlocked: true, granted: false },
    { probe: 'spark', name: 'Chispa', level: 6, maxLevel: 10, variant: 'spark-fan', variants: [{ id: 'spark-fan', name: 'Abanico', unlockAt: 4 }], unlocked: true, granted: false },
    { probe: 'vela', name: 'Vela', level: 1, maxLevel: 10, variant: null, variants: [], unlocked: true, granted: true },
    { probe: 'nox', name: 'Nox', level: 1, maxLevel: 10, variant: null, variants: [], unlocked: false, granted: false },
  ],
  rooms: [{ room: 'refinery', level: 2, maxLevel: 5 }],
  lab: [{ node: 'hull-1', name: 'Casco reforzado', level: 3, max: 5 }],
  season: { id: 'season-1', name: 'Temporada 1', points: 340, adjustments: 100 },
};
const P = '/galaxy/api/admin/players/vega';
const posted = (fetch: ReturnType<typeof mockApi>, path: string) =>
  fetch.mock.calls.filter(([url, init]) => url === `${P}/${path}` && init?.method === 'POST').map(([, init]) => JSON.parse(String(init?.body ?? '{}')));

function open(routes: Record<string, (b: unknown) => Response> = {}) {
  const fetch = mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, admin),
    [`GET ${P}`]: () => jsonResponse(200, player),
    [`GET ${P}/progress`]: () => jsonResponse(200, progress),
    ...routes,
  });
  renderAt('/admin/jugadores/vega', { '/admin/jugadores/:username': <PlayerScreen /> });
  return fetch;
}
async function tab() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('tab', { name: t.tabs.progress }));
  return user;
}

test('la pestaña Progreso enseña la suerte, las sondas, la estación, el laboratorio y la temporada', async () => {
  open();
  await tab();
  const luck = await screen.findByRole('table', { name: g.gachaTitle });
  expect(within(luck).getByRole('row', { name: /standard/ })).toHaveTextContent('7');
  const probes = screen.getByRole('table', { name: g.probesTitle });
  expect(within(probes).getByRole('row', { name: /Lumen/ })).toHaveTextContent(g.levelOf(4, 10));
  expect(within(probes).getByRole('row', { name: /Vela/ })).toHaveTextContent(g.grantedByAdmin);
  expect(within(probes).getByRole('row', { name: /Nox/ })).toHaveTextContent(g.locked);
  expect(within(screen.getByRole('table', { name: g.roomsTitle })).getByRole('row', { name: /Refinería/ })).toHaveTextContent(g.levelOf(2, 5));
  expect(within(screen.getByRole('table', { name: g.labTitle })).getByRole('row', { name: /Casco reforzado/ })).toHaveTextContent(g.levelOf(3, 5));
  expect(screen.getByText(g.seasonLine('Temporada 1', 340, 100))).toBeInTheDocument();
});

test('subir una sonda pide solo el motivo; bajarla pide además la contraseña', async () => {
  const fetch = open({ [`POST ${P}/probe`]: () => jsonResponse(200, progress) });
  const user = await tab();
  const row = within(await screen.findByRole('table', { name: g.probesTitle })).getByRole('row', { name: /Lumen/ });
  await user.click(within(row).getByRole('button', { name: g.levelOfProbe('Lumen') }));
  let dialog = await screen.findByRole('dialog', { name: g.levelOfProbe('Lumen') });
  const level = within(dialog).getByLabelText(g.fields.level);
  expect(level).toHaveValue('4');
  await user.clear(level);
  await user.type(level, '6');
  expect(within(dialog).queryByLabelText(t.fields.password)).toBeNull();
  await pickOption(user, within(dialog).getByLabelText(g.fields.variant), 'pulse-wide');
  await user.type(within(dialog).getByLabelText(t.fields.reason), 'Compensación');
  await user.click(within(dialog).getByRole('button', { name: t.apply }));
  await waitFor(() => expect(posted(fetch, 'probe')).toEqual([{ probe: 'lumen', level: 6, variant: 'pulse-wide', reason: 'Compensación' }]));
  await user.click(within(row).getByRole('button', { name: g.levelOfProbe('Lumen') }));
  dialog = await screen.findByRole('dialog', { name: g.levelOfProbe('Lumen') });
  await user.clear(within(dialog).getByLabelText(g.fields.level));
  await user.type(within(dialog).getByLabelText(g.fields.level), '2');
  expect(within(dialog).getByLabelText(t.fields.password)).toBeInTheDocument();
});

test('una sonda desbloqueada por un admin se bloquea con la contraseña; una bloqueada se desbloquea sin ella', async () => {
  const fetch = open({ [`POST ${P}/probe-grant`]: () => jsonResponse(200, progress) });
  const user = await tab();
  const probes = await screen.findByRole('table', { name: g.probesTitle });
  await user.click(within(within(probes).getByRole('row', { name: /Vela/ })).getByRole('button', { name: g.lockOf('Vela') }));
  expect(within(await screen.findByRole('dialog', { name: g.lockOf('Vela') })).getByLabelText(t.fields.password)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: t.cancel }));
  await user.click(within(within(probes).getByRole('row', { name: /Nox/ })).getByRole('button', { name: g.unlockOf('Nox') }));
  const dialog = await screen.findByRole('dialog', { name: g.unlockOf('Nox') });
  expect(within(dialog).queryByLabelText(t.fields.password)).toBeNull();
  await user.type(within(dialog).getByLabelText(t.fields.reason), 'Premio del torneo');
  await user.click(within(dialog).getByRole('button', { name: t.apply }));
  await waitFor(() => expect(posted(fetch, 'probe-grant')).toEqual([{ probe: 'nox', granted: true, reason: 'Premio del torneo' }]));
});

test('quitar puntos de temporada pide la contraseña', async () => {
  const fetch = open({ [`POST ${P}/season`]: () => jsonResponse(200, progress) });
  const user = await tab();
  await user.click(await screen.findByRole('button', { name: g.adjustSeason }));
  const dialog = await screen.findByRole('dialog', { name: g.adjustSeason });
  await user.type(within(dialog).getByLabelText(g.fields.points), '-30');
  await user.type(within(dialog).getByLabelText(t.fields.reason), 'Puntos de una partida con trampas');
  await user.type(within(dialog).getByLabelText(t.fields.password), 'secreta');
  await user.click(within(dialog).getByRole('button', { name: t.apply }));
  await waitFor(() => expect(posted(fetch, 'season')).toEqual([{ points: -30, reason: 'Puntos de una partida con trampas', password: 'secreta' }]));
});

test('la suerte del gachapón se cambia con los valores de ahora ya puestos', async () => {
  const fetch = open({ [`POST ${P}/gacha-luck`]: () => jsonResponse(200, progress) });
  const user = await tab();
  const row = within(await screen.findByRole('table', { name: g.gachaTitle })).getByRole('row', { name: /standard/ });
  await user.click(within(row).getByRole('button', { name: g.luckOf('standard') }));
  const dialog = await screen.findByRole('dialog', { name: g.luckOf('standard') });
  expect(within(dialog).getByLabelText(g.fields.sinceLegendary)).toHaveValue('7');
  // Raising asks only for a reason; turning the welcome luck off takes it away: the password.
  await user.clear(within(dialog).getByLabelText(g.fields.sinceLegendary));
  await user.type(within(dialog).getByLabelText(g.fields.sinceLegendary), '9');
  expect(within(dialog).queryByLabelText(t.fields.password)).toBeNull();
  await pickOption(user, within(dialog).getByLabelText(g.fields.welcome), 'false');
  await user.type(within(dialog).getByLabelText(t.fields.reason), 'Fin de la bienvenida');
  await user.type(within(dialog).getByLabelText(t.fields.password), 'secreta');
  await user.click(within(dialog).getByRole('button', { name: t.apply }));
  await waitFor(() => expect(posted(fetch, 'gacha-luck')).toEqual([{ group: 'standard', sinceLegendary: 9, sinceFeatured: 0, welcome: false, reason: 'Fin de la bienvenida', password: 'secreta' }]));
});

test('dar una galaxia deja elegir el tipo', async () => {
  const fetch = open({ [`POST ${P}/galaxies`]: () => jsonResponse(200, { id: 'g1' }) });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: t.actions.grant }));
  const dialog = await screen.findByRole('dialog', { name: t.actions.grant });
  await pickOption(user, within(dialog).getByLabelText(t.fields.type), 'ring');
  await user.type(within(dialog).getByLabelText(t.fields.reason), 'Premio de un evento');
  await user.click(within(dialog).getByRole('button', { name: t.apply }));
  await waitFor(() => expect(posted(fetch, 'galaxies')[0]).toMatchObject({ type: 'ring' }));
});

test('bajar una sonda por debajo de su arma elegida la devuelve al arma base', async () => {
  const fetch = open({ [`POST ${P}/probe`]: () => jsonResponse(200, progress) });
  const user = await tab();
  const row = within(await screen.findByRole('table', { name: g.probesTitle })).getByRole('row', { name: /Chispa/ });
  await user.click(within(row).getByRole('button', { name: g.levelOfProbe('Chispa') }));
  const dialog = await screen.findByRole('dialog', { name: g.levelOfProbe('Chispa') });
  expect(within(dialog).getByRole('combobox', { name: g.fields.variant })).toHaveTextContent(g.variantOpt('Abanico', 4));
  await user.clear(within(dialog).getByLabelText(g.fields.level));
  await user.type(within(dialog).getByLabelText(g.fields.level), '2');
  await user.type(within(dialog).getByLabelText(t.fields.reason), 'Corrección');
  await user.type(within(dialog).getByLabelText(t.fields.password), 'secreta');
  await user.click(within(dialog).getByRole('button', { name: t.apply }));
  await waitFor(() => expect(posted(fetch, 'probe')).toEqual([{ probe: 'spark', level: 2, variant: null, reason: 'Corrección', password: 'secreta' }]));
});
