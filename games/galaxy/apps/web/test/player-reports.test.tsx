import type { PlayerReportPage } from '@galaxy/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { PlayerReports } from '../src/admin/PlayerReports';
import { ReportDialog } from '../src/coop/ReportDialog';
import { TeamResults } from '../src/coop/TeamResults';
import { copy } from '../src/copy/es';
import { jsonResponse, mockApi, renderAt } from './render';

// Reports of players (multiplayer plan, phase 7): «Denunciar» on each teammate of the results, the dialog with its
// reasons and note, and Moderación › Jugadores with its review.

const r = copy.coop.report;
const p = copy.admin.moderation.playerReports;
const RUN = '00000000-0000-4000-8000-0000000000f1';
const posted = (fetch: ReturnType<typeof mockApi>, url: string) =>
  fetch.mock.calls.filter(([u, init]) => u === url && init?.method === 'POST').map(([, init]) => JSON.parse(String(init?.body ?? '{}')));
const row = (slot: number, name: string) => ({ slot, name, probe: 'Lumen', sprite: 'probe-lumen', level: 3, kills: 10, revives: 0, downs: 0, life: 'up' as const });

test('«Denunciar» sale en cada compañero, nunca en la fila propia', async () => {
  const onReport = vi.fn();
  render(<TeamResults rows={[row(0, 'sonda_rayo'), row(1, 'vega')]} me={0} onReport={onReport} />);
  expect(screen.queryByRole('button', { name: r.openOf('sonda_rayo') })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: r.openOf('vega') }));
  expect(onReport).toHaveBeenCalledWith('vega');
});

test('la denuncia pide un motivo, lleva la nota y dice que la revisará un moderador', async () => {
  const fetch = mockApi({ [`POST /galaxy/api/coop/runs/${RUN}/report`]: () => jsonResponse(200, { reported: true }) });
  renderAt('/x', { '/x': <ReportDialog runId={RUN} username="vega" onClose={() => {}} /> });
  const dialog = await screen.findByRole('dialog', { name: r.title('vega') });
  expect(within(dialog).getByRole('button', { name: r.send })).toBeDisabled();
  await userEvent.click(within(dialog).getByRole('radio', { name: r.reasons.idle }));
  await userEvent.type(within(dialog).getByLabelText(r.note), 'No se movió');
  await userEvent.click(within(dialog).getByRole('button', { name: r.send }));
  expect(await screen.findByText(r.sent)).toBeInTheDocument();
  expect(posted(fetch, `/galaxy/api/coop/runs/${RUN}/report`)).toEqual([{ username: 'vega', reason: 'idle', note: 'No se movió' }]);
});

test('Moderación › Jugadores: cada denuncia con su partida, y descartarla pide un motivo', async () => {
  const page: PlayerReportPage = {
    reports: [{ id: 'pr1', reporter: 'lyra', reported: 'vega', reason: 'griefing', note: 'Nos dejaba caer', at: '2026-11-09T20:00:00.000Z', coopRunId: RUN, reportedRunId: '00000000-0000-4000-8000-0000000000f2', sector: 'outer-nebula' }],
    total: 1,
    page: 1,
    pages: 1,
  };
  const fetch = mockApi({
    'GET /galaxy/api/admin/moderation/player-reports?page=1': () => jsonResponse(200, page),
    'POST /galaxy/api/admin/moderation/player-reports/pr1': () => jsonResponse(200, { reviewed: true }),
  });
  renderAt('/admin/moderacion/jugadores', { '/admin/moderacion/jugadores': <PlayerReports /> });
  const table = await screen.findByRole('table', { name: copy.admin.moderation.tabs.players });
  expect(within(table).getByText(r.reasons.griefing)).toBeInTheDocument();
  expect(within(table).getByText('Nos dejaba caer')).toBeInTheDocument();
  expect(within(table).getByRole('link', { name: p.replayOf('vega') })).toHaveAttribute('href', '/admin/partidas/00000000-0000-4000-8000-0000000000f2');
  await userEvent.click(within(table).getByRole('button', { name: p.dismissOf('vega') }));
  const dialog = await screen.findByRole('dialog', { name: p.dismissOf('vega') });
  await userEvent.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Estaba ayudando');
  await userEvent.click(within(dialog).getByRole('button', { name: p.submit }));
  await waitFor(() => expect(posted(fetch, '/galaxy/api/admin/moderation/player-reports/pr1')).toEqual([{ outcome: 'dismissed', reason: 'Estaba ayudando' }]));
});
