import type { AdminPlayer, AdminRunList, AdminRunReplay, AdminSection, MeResponse } from '@galaxy/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { AdminLayout } from '../src/admin/AdminLayout';
import { clockText } from '../src/arena/hud/Hud';
import { PlayerScreen } from '../src/admin/PlayerScreen';
import { ReplayScreen } from '../src/admin/ReplayScreen';
import { RunsScreen } from '../src/admin/RunsScreen';
import { copy } from '../src/copy/es';
import { jsonResponse, mockApi, renderAt } from './render';
import { playedRun } from './replay-fixture';

// The panel's runs on the web (GDD §16.2, §16.6; M6d-3), admins only: the list with its filters, a run's replay with
// play, speed and a timeline, «Comprobar» against what was kept, and marking it. The PixiJS stage is replaced: jsdom has
// no WebGL (the stage has its own browser test).

vi.mock('../src/arena/stage/stage', () => ({
  createStage: vi.fn(async () => ({
    app: {},
    render: vi.fn(),
    feed: vi.fn(),
    resize: vi.fn(),
    camera: () => ({ zoom: 2, worldW: 640, worldH: 360, bars: 0, x: 0, y: 0 }),
    destroy: vi.fn(),
  })),
}));
afterEach(() => vi.unstubAllGlobals());

const t = copy.admin.runs;
const admin: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };
const R = '/galaxy/api/admin/runs';
const played = playedRun(900);
const row = played.run;
const listOf = (runs = [row]): AdminRunList => ({ runs, total: runs.length, page: 1, pages: 1 });
const replayAt = (r: AdminRunReplay) => renderAt(`/admin/partidas/${r.run.id}`, { '/admin/partidas/:id': <ReplayScreen /> });

test('la barra lateral lleva a Partidas', async () => {
  mockApi({ 'GET /galaxy/api/auth/me': () => jsonResponse(200, admin) });
  renderAt('/admin', { '/admin': <AdminLayout /> });
  const nav = await screen.findByRole('navigation', { name: copy.admin.nav });
  expect(within(nav).getByRole('link', { name: copy.admin.sections.runs })).toHaveAttribute('href', '/admin/partidas');
});

test('la lista filtra por sospechosas y por jugador, y cada fila lleva a su repetición', async () => {
  const fetch = mockApi({
    [`GET ${R}?page=1`]: () => jsonResponse(200, listOf()),
    [`GET ${R}?suspicious=true&page=1`]: () => jsonResponse(200, listOf([])),
    [`GET ${R}?player=vega&suspicious=true&page=1`]: () => jsonResponse(200, listOf([])),
  });
  renderAt('/admin/partidas', { '/admin/partidas': <RunsScreen /> });
  const table = await screen.findByRole('table');
  expect(within(table).getByText(t.outcomes.abandoned)).toBeInTheDocument();
  expect(within(table).getByRole('link', { name: t.viewOf('vega') })).toHaveAttribute('href', `/admin/partidas/${row.id}`);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: t.onlySuspicious }));
  expect(screen.getByRole('button', { name: t.onlySuspicious })).toHaveAttribute('aria-pressed', 'true');
  await waitFor(() => expect(fetch.mock.calls.some(([u]) => u === `${R}?suspicious=true&page=1`)).toBe(true));
  await user.type(screen.getByRole('searchbox', { name: t.player }), 'vega');
  await waitFor(() => expect(fetch.mock.calls.some(([u]) => u === `${R}?player=vega&suspicious=true&page=1`)).toBe(true));
  expect(await screen.findByText(t.empty)).toBeInTheDocument();
});

test('una partida en grupo dice cuántos eran, y el filtro En grupo lo pide (fase 7)', async () => {
  const fetch = mockApi({
    [`GET ${R}?page=1`]: () => jsonResponse(200, listOf([{ ...row, party: 3 }])),
    [`GET ${R}?group=true&page=1`]: () => jsonResponse(200, listOf([{ ...row, party: 3 }])),
  });
  renderAt('/admin/partidas', { '/admin/partidas': <RunsScreen /> });
  const table = await screen.findByRole('table');
  expect(within(table).getByText(t.party(3))).toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: t.onlyGroup }));
  expect(screen.getByRole('button', { name: t.onlyGroup })).toHaveAttribute('aria-pressed', 'true');
  await waitFor(() => expect(fetch.mock.calls.some(([u]) => u === `${R}?group=true&page=1`)).toBe(true));
});

test('una partida sin terminar no se reproduce y lo dice', async () => {
  const open: AdminRunReplay = { ...played, run: { ...row, outcome: null, finishedAt: null, ticks: null, hash: null }, inputs: null };
  mockApi({ [`GET ${R}/${row.id}`]: () => jsonResponse(200, open) });
  replayAt(open);
  expect(await screen.findByText(t.noInputs)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: t.play })).toBeNull();
  expect(screen.queryByRole('button', { name: t.mark })).toBeNull();
});

test('una partida terminada sin entradas guardadas lo dice y aún se puede marcar', async () => {
  const bare: AdminRunReplay = { ...played, inputs: null };
  mockApi({ [`GET ${R}/${row.id}`]: () => jsonResponse(200, bare) });
  replayAt(bare);
  expect(await screen.findByText(t.noLog)).toBeInTheDocument();
  expect(screen.queryByText(t.noInputs)).toBeNull();
  expect(screen.queryByRole('button', { name: t.play })).toBeNull();
  expect(screen.getByRole('button', { name: t.mark })).toBeInTheDocument();
});

test('otra versión de la simulación avisa antes de reproducir', async () => {
  const older: AdminRunReplay = { ...played, run: { ...row, simVersion: '1.0.0' } };
  mockApi({ [`GET ${R}/${row.id}`]: () => jsonResponse(200, older) });
  replayAt(older);
  expect(await screen.findByRole('note')).toHaveTextContent('1.0.0');
  expect(screen.getByRole('button', { name: t.play })).toBeInTheDocument();
});

test('la repetición se reproduce, cambia de velocidad y se mueve por la línea de tiempo', async () => {
  mockApi({ [`GET ${R}/${row.id}`]: () => jsonResponse(200, played) });
  replayAt(played);
  expect(await screen.findByRole('heading', { level: 1, name: t.heading('vega') })).toBeInTheDocument();
  const timeline = screen.getByRole('slider', { name: t.timeline });
  expect(timeline).toHaveAttribute('aria-valuetext', t.timeAt('0:00', '0:15'));
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: t.speedOf(4) }));
  expect(screen.getByRole('button', { name: t.speedOf(4) })).toHaveAttribute('aria-pressed', 'true');
  await user.click(screen.getByRole('button', { name: t.toEnd }));
  await waitFor(() => expect(screen.getByRole('slider', { name: t.timeline })).toHaveAttribute('aria-valuetext', t.timeAt('0:15', '0:15')));
  expect(screen.getByText(t.ended)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: t.restart }));
  await waitFor(() => expect(screen.getByRole('slider', { name: t.timeline })).toHaveAttribute('aria-valuetext', t.timeAt('0:00', '0:15')));
  expect(screen.getByRole('button', { name: t.play })).toBeInTheDocument();
});

test('Comprobar dice si coincide con lo guardado, y si no, qué cambia', async () => {
  mockApi({ [`GET ${R}/${row.id}`]: () => jsonResponse(200, played) });
  const { unmount } = replayAt(played);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: t.check }));
  expect(await screen.findByText(t.matches)).toBeInTheDocument();
  unmount();
  // The client sent more kills than its own run had (with the right hash).
  const forged: AdminRunReplay = { ...played, run: { ...row, claimed: { ...row.claimed!, kills: row.claimed!.kills + 50 } } };
  mockApi({ [`GET ${R}/${row.id}`]: () => jsonResponse(200, forged) });
  replayAt(forged);
  await user.click(await screen.findByRole('button', { name: t.check }));
  expect(await screen.findByText(t.differs)).toBeInTheDocument();
  const kills = within(screen.getByRole('table', { name: t.checkTitle })).getByRole('rowheader', { name: t.checkKeys.kills }).closest('tr')!;
  expect(within(kills).getByText(t.different)).toBeInTheDocument();
});

test('marcar pide un motivo y avisa de que la paga no cambia', async () => {
  const fetch = mockApi({
    [`GET ${R}/${row.id}`]: () => jsonResponse(200, played),
    [`POST ${R}/${row.id}/mark`]: () => jsonResponse(200, { suspicious: true, flags: ['admin'] }),
  });
  replayAt(played);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: t.mark }));
  const dialog = await screen.findByRole('dialog', { name: t.mark });
  expect(dialog).toHaveTextContent(t.markIntro);
  await user.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Movimientos imposibles');
  await user.click(within(dialog).getByRole('button', { name: t.mark }));
  await waitFor(() => {
    const call = fetch.mock.calls.find(([u, init]) => u === `${R}/${row.id}/mark` && init?.method === 'POST');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ suspicious: true, reason: 'Movimientos imposibles' });
  });
  // Done: the dialog closes (it never turns into the opposite action) and the page says so.
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('status')).toHaveTextContent(t.markedDone);
});

test('en la ficha del jugador cada partida lleva a su repetición', async () => {
  const player = { id: 'p1', username: 'vega', createdAt: '2026-11-01T10:00:00.000Z', deletedAt: null, roles: [], level: 12, xp: 15000, banned: null, muted: null, leaderboardExcluded: false, clan: null, wallet: { coins: 0, dust: 0, signal: 0, material: 0, components: 0 }, counts: { galaxies: 0, runs: 1, pulls: 0, listings: 0, trades: 0, messages: 0 }, sessions: [], ips: [], station: [], lab: [], probes: [] } satisfies AdminPlayer;
  const runs: AdminSection = { rows: [{ id: row.id, at: row.startedAt, sector: 'outer-nebula', probe: 'lumen', outcome: 'abandoned', seconds: 15, depth: 1, kills: 3, suspicious: false, flags: '' }], page: 1, pages: 1 };
  mockApi({ 'GET /galaxy/api/admin/players/vega': () => jsonResponse(200, player), 'GET /galaxy/api/admin/players/vega/runs?page=1': () => jsonResponse(200, runs) });
  renderAt('/admin/jugadores/vega', { '/admin/jugadores/:username': <PlayerScreen /> });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('tab', { name: copy.admin.tabs.runs }));
  expect(await screen.findByRole('link', { name: t.viewOf('vega') })).toHaveAttribute('href', `/admin/partidas/${row.id}`);
});

describe('revisión final', () => {
  test('Comprobar termina también en StrictMode', async () => {
    mockApi({ [`GET ${R}/${row.id}`]: () => jsonResponse(200, played) });
    renderAt(`/admin/partidas/${row.id}`, { '/admin/partidas/:id': <StrictMode><ReplayScreen /></StrictMode> });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: t.check }));
    expect(await screen.findByText(t.matches)).toBeInTheDocument();
  });

  test('con la línea de tiempo enfocada, espacio reproduce y las flechas mueven 5 segundos', async () => {
    mockApi({ [`GET ${R}/${row.id}`]: () => jsonResponse(200, played) });
    replayAt(played);
    const timeline = await screen.findByRole('slider', { name: t.timeline });
    timeline.focus();
    fireEvent.keyDown(timeline, { code: 'ArrowRight', key: 'ArrowRight' });
    await waitFor(() => expect(timeline).toHaveAttribute('aria-valuetext', t.timeAt('0:05', '0:15')));
    fireEvent.keyDown(timeline, { code: 'Space', key: ' ' });
    expect(screen.getByRole('button', { name: t.pause })).toBeInTheDocument();
  });

  test('dos flechas seguidas durante una búsqueda larga cuentan desde su destino', async () => {
    const long = playedRun(7200);
    const end = long.run.ticks!;
    expect(end).toBeGreaterThan(3600);
    mockApi({ [`GET ${R}/${long.run.id}`]: () => jsonResponse(200, long) });
    replayAt(long);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: t.toEnd }));
    const timeline = screen.getByRole('slider', { name: t.timeline });
    const at = (tick: number) => t.timeAt(clockText(tick / 60), clockText(end / 60));
    await waitFor(() => expect(timeline).toHaveAttribute('aria-valuetext', at(end)));
    fireEvent.keyDown(window, { code: 'ArrowLeft', key: 'ArrowLeft' });
    fireEvent.keyDown(window, { code: 'ArrowLeft', key: 'ArrowLeft' });
    await waitFor(() => expect(timeline).toHaveAttribute('aria-valuetext', at(end - 600)), { timeout: 4000 });
  });

  test('una partida que el servidor recortó se comprueba con lo que envió', async () => {
    const clipped: AdminRunReplay = { ...played, run: { ...row, ticks: 300, kills: 0, flags: ['too_fast'] } };
    mockApi({ [`GET ${R}/${row.id}`]: () => jsonResponse(200, clipped) });
    replayAt(clipped);
    expect(await screen.findByRole('slider', { name: t.timeline })).toHaveAttribute('aria-valuetext', t.timeAt('0:00', '0:15'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: t.check }));
    expect(await screen.findByText(t.matches)).toBeInTheDocument();
    expect(screen.queryByText(t.clipped)).toBeNull();
  });

  test('una partida recortada de antes, sin lo que envió, avisa de que puede no coincidir', async () => {
    const old: AdminRunReplay = { ...played, run: { ...row, ticks: 300, kills: 0, flags: ['too_fast'], claimed: null } };
    mockApi({ [`GET ${R}/${row.id}`]: () => jsonResponse(200, old) });
    replayAt(old);
    expect(await screen.findByText(t.clipped)).toBeInTheDocument();
  });

  test('una repetición que no se puede construir lo dice y deja marcar', async () => {
    const broken: AdminRunReplay = { ...played, inputs: 'AAAA' };
    mockApi({ [`GET ${R}/${row.id}`]: () => jsonResponse(200, broken) });
    replayAt(broken);
    expect(await screen.findByText(t.cannotReplay)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.mark })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: t.detailsTitle })).toBeInTheDocument();
  });

  test('si el contenido de su versión ya no está, lo dice', async () => {
    const gone: AdminRunReplay = { ...played, run: { ...row, contentVersion: 7 }, contentFallback: true };
    mockApi({ [`GET ${R}/${row.id}`]: () => jsonResponse(200, gone) });
    replayAt(gone);
    expect(await screen.findByText(t.contentFallback(7))).toBeInTheDocument();
  });
});
