import type { AdminMailRow, AdminNoticeRow, MeResponse } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { AdminLayout } from '../src/admin/AdminLayout';
import { CommunicationScreen } from '../src/admin/CommunicationScreen';
import { copy } from '../src/copy/es';
import { jsonResponse, mockApi, renderAt } from './render';

// Communication in the panel (GDD §16.5; M6d-1), admins only: a message to everyone or a list of accounts, with how
// many it reaches before sending, gifts that ask for the password, the sent list with withdraw; and notices with
// their dates, ended early with a reason.
afterEach(() => vi.unstubAllGlobals());

const t = copy.admin.communication;
const admin: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };
const sent: AdminMailRow[] = [
  { id: 'm1', title: 'Bienvenida', body: 'Hola', gifts: { coins: 100 }, audience: { kind: 'all' }, by: 'rayelus', at: '2026-11-08T10:00:00.000Z', expiresAt: '2026-12-08T10:00:00.000Z', withdrawnAt: null, recipients: 40, read: 12, claimed: 9 },
];
const notices: AdminNoticeRow[] = [
  { id: 'n1', text: 'Mantenimiento el domingo', tone: 'warning', startsAt: '2026-11-08T10:00:00.000Z', endsAt: '2026-11-10T10:00:00.000Z', endedAt: null, by: 'rayelus', live: true },
];
const posted = (fetch: ReturnType<typeof mockApi>, url: string) =>
  fetch.mock.calls.filter(([u, init]) => u === url && init?.method === 'POST').map(([, init]) => JSON.parse(String(init?.body ?? '{}')));
const routes = (extra = {}) => ({
  'GET /galaxy/api/auth/me': () => jsonResponse(200, admin),
  'GET /galaxy/api/admin/mail': () => jsonResponse(200, sent),
  'GET /galaxy/api/admin/notices': () => jsonResponse(200, notices),
  'POST /galaxy/api/admin/mail/preview': (body: unknown) => jsonResponse(200, { recipients: (body as { audience: { kind: string } }).audience.kind === 'all' ? 40 : 2 }),
  ...extra,
});

test('la barra lateral lleva a Comunicación', async () => {
  mockApi(routes());
  renderAt('/admin', { '/admin': <AdminLayout /> });
  const nav = await screen.findByRole('navigation', { name: copy.admin.nav });
  expect(within(nav).getByRole('link', { name: copy.admin.sections.communication })).toHaveAttribute('href', '/admin/comunicacion');
});

test('enviar a una lista de cuentas dice a cuántas llega y manda solo lo escrito', async () => {
  const fetch = mockApi(routes({ 'POST /galaxy/api/admin/mail': () => jsonResponse(200, { id: 'm9', recipients: 2 }) }));
  renderAt('/admin/comunicacion', { '/admin/comunicacion': <CommunicationScreen /> });
  const form = await screen.findByRole('form', { name: t.composeTitle });
  await userEvent.type(within(form).getByLabelText(t.fields.title), 'Gracias por probar');
  await userEvent.type(within(form).getByLabelText(t.fields.body), 'Un saludo del equipo');
  await userEvent.selectOptions(within(form).getByLabelText(t.fields.audience), 'names');
  await userEvent.type(within(form).getByLabelText(t.fields.usernames), 'vega, nova');
  expect(await within(form).findByText(t.reach(2))).toBeInTheDocument();
  expect(within(form).queryByLabelText(copy.admin.fields.password)).toBeNull();
  await userEvent.type(within(form).getByLabelText(copy.admin.fields.reason), 'Agradecimiento');
  await userEvent.click(within(form).getByRole('button', { name: t.send(2) }));
  await waitFor(() =>
    expect(posted(fetch, '/galaxy/api/admin/mail')).toEqual([
      { title: 'Gracias por probar', body: 'Un saludo del equipo', gifts: {}, audience: { kind: 'segment', usernames: ['vega', 'nova'] }, expiresInDays: 30, reason: 'Agradecimiento' },
    ]),
  );
  expect(await screen.findByRole('status')).toHaveTextContent(t.sent(2));
});

test('con regalos pide la contraseña y la manda', async () => {
  const fetch = mockApi(routes({ 'POST /galaxy/api/admin/mail': () => jsonResponse(200, { id: 'm9', recipients: 40 }) }));
  renderAt('/admin/comunicacion', { '/admin/comunicacion': <CommunicationScreen /> });
  const form = await screen.findByRole('form', { name: t.composeTitle });
  await userEvent.type(within(form).getByLabelText(t.fields.title), 'Regalo');
  await userEvent.type(within(form).getByLabelText(t.fields.body), 'Para todos');
  await userEvent.type(within(form).getByLabelText(t.gifts.coins), '100');
  await userEvent.type(within(form).getByLabelText(copy.admin.fields.reason), 'Inicio de la beta');
  expect(within(form).getByRole('button', { name: t.send(40) })).toBeDisabled();
  await userEvent.type(within(form).getByLabelText(copy.admin.fields.password), 'mi-clave');
  await userEvent.click(within(form).getByRole('button', { name: t.send(40) }));
  await waitFor(() => expect(posted(fetch, '/galaxy/api/admin/mail')[0]).toMatchObject({ gifts: { coins: 100 }, audience: { kind: 'all' }, password: 'mi-clave' }));
});

test('la lista de enviados dice a cuántos llegó, leídos y recogidos, y se retira con motivo', async () => {
  const fetch = mockApi(routes({ 'POST /galaxy/api/admin/mail/m1/withdraw': () => jsonResponse(200, { withdrawn: true }) }));
  renderAt('/admin/comunicacion', { '/admin/comunicacion': <CommunicationScreen /> });
  const table = await screen.findByRole('table', { name: t.sentTitle });
  const row = within(table).getByRole('cell', { name: 'Bienvenida' }).closest('tr')!;
  expect(within(row).getByText('40')).toBeInTheDocument();
  expect(within(row).getByText('12')).toBeInTheDocument();
  expect(within(row).getByText('9')).toBeInTheDocument();
  await userEvent.click(within(row).getByRole('button', { name: t.withdrawOf('Bienvenida') }));
  const dialog = await screen.findByRole('dialog', { name: t.withdrawOf('Bienvenida') });
  await userEvent.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Enviado por error');
  await userEvent.click(within(dialog).getByRole('button', { name: t.withdraw }));
  await waitFor(() => expect(posted(fetch, '/galaxy/api/admin/mail/m1/withdraw')).toEqual([{ reason: 'Enviado por error' }]));
});

test('un aviso se publica con sus fechas y uno en curso se termina con motivo', async () => {
  const fetch = mockApi(
    routes({
      'POST /galaxy/api/admin/notices': () => jsonResponse(200, { id: 'n9' }),
      'POST /galaxy/api/admin/notices/n1/end': () => jsonResponse(200, { ended: true }),
    }),
  );
  renderAt('/admin/comunicacion', { '/admin/comunicacion': <CommunicationScreen /> });
  const form = await screen.findByRole('form', { name: t.noticeTitle });
  await userEvent.type(within(form).getByLabelText(t.fields.noticeText), 'Nueva temporada el lunes');
  await userEvent.selectOptions(within(form).getByLabelText(t.fields.tone), 'info');
  await userEvent.type(within(form).getByLabelText(t.fields.startsAt), '2026-11-09T10:00');
  await userEvent.type(within(form).getByLabelText(t.fields.endsAt), '2026-11-10T10:00');
  await userEvent.type(within(form).getByLabelText(copy.admin.fields.reason), 'Anuncio de temporada');
  await userEvent.click(within(form).getByRole('button', { name: t.publishNotice }));
  await waitFor(() => expect(posted(fetch, '/galaxy/api/admin/notices')[0]).toMatchObject({ text: 'Nueva temporada el lunes', tone: 'info', reason: 'Anuncio de temporada' }));
  const sentNotice = posted(fetch, '/galaxy/api/admin/notices')[0] as { startsAt: string; endsAt: string };
  expect(Date.parse(sentNotice.endsAt) - Date.parse(sentNotice.startsAt)).toBe(86_400_000);

  const table = screen.getByRole('table', { name: t.noticesTitle });
  const row = within(table).getByRole('cell', { name: 'Mantenimiento el domingo' }).closest('tr')!;
  expect(within(row).getByText(t.states.live)).toBeInTheDocument();
  await userEvent.click(within(row).getByRole('button', { name: t.endOf('Mantenimiento el domingo') }));
  const dialog = await screen.findByRole('dialog', { name: t.endOf('Mantenimiento el domingo') });
  await userEvent.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Ya terminó');
  await userEvent.click(within(dialog).getByRole('button', { name: t.end }));
  await waitFor(() => expect(posted(fetch, '/galaxy/api/admin/notices/n1/end')).toEqual([{ reason: 'Ya terminó' }]));
});

test('un segmento con los niveles al revés o nombres no válidos dice qué corregir en lugar de quedarse contando', async () => {
  mockApi(routes());
  renderAt('/admin/comunicacion', { '/admin/comunicacion': <CommunicationScreen /> });
  const form = await screen.findByRole('form', { name: t.composeTitle });
  await userEvent.selectOptions(within(form).getByLabelText(t.fields.audience), 'segment');
  await userEvent.type(within(form).getByLabelText(t.fields.minLevel), '10');
  await userEvent.type(within(form).getByLabelText(t.fields.maxLevel), '5');
  expect(await within(form).findByText(t.audienceInvalid)).toBeInTheDocument();
  expect(within(form).queryByText(t.counting)).toBeNull();
  await userEvent.selectOptions(within(form).getByLabelText(t.fields.audience), 'names');
  await userEvent.type(within(form).getByLabelText(t.fields.usernames), 'vega, x!');
  expect(await within(form).findByText(t.badNames('x!'))).toBeInTheDocument();
});
