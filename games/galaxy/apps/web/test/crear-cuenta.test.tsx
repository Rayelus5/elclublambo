import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { CrearCuenta } from '../src/routes/CrearCuenta';
import { jsonResponse, locationOf, mockApi, renderAt } from './render';

afterEach(() => vi.unstubAllGlobals());

/** The sign-ups asked for (the form also reads, on its own, whether a code is needed). */
const posts = (fetch: ReturnType<typeof mockApi>) => fetch.mock.calls.filter(([url, init]) => url === '/galaxy/api/auth/register' && init?.method === 'POST');

const fields = () => ({
  user: screen.getByLabelText('Usuario'),
  pass: screen.getByLabelText('Contraseña'),
  pass2: screen.getByLabelText('Repite la contraseña'),
  submit: screen.getByRole('button', { name: 'Crear cuenta' }),
});

test('un usuario inválido se marca al salir del campo, con el mensaje junto a él', async () => {
  mockApi({});
  renderAt('/crear-cuenta', { '/crear-cuenta': <CrearCuenta /> });
  const user = userEvent.setup();
  const f = fields();
  await user.type(f.user, 'ab');
  await user.tab();
  expect(f.user).toHaveAttribute('aria-invalid', 'true');
  expect(f.user).toHaveAccessibleDescription(copy.crear.userError);
});

test('no envía si algo no vale: usuario, contraseña corta, igual al usuario o que no coincide', async () => {
  const fetch = mockApi({});
  renderAt('/crear-cuenta', { '/crear-cuenta': <CrearCuenta /> });
  const user = userEvent.setup();
  const f = fields();
  await user.type(f.user, 'piloto_0123');
  await user.type(f.pass, 'PILOTO_0123');
  await user.type(f.pass2, 'PILOTO_0123');
  await user.click(f.submit);
  expect(f.pass).toHaveAttribute('aria-invalid', 'true');
  expect(f.pass).toHaveAccessibleDescription(copy.crear.passError);
  await user.clear(f.pass);
  await user.type(f.pass, 'una-clave-larga');
  await user.click(f.submit);
  expect(f.pass2).toHaveAttribute('aria-invalid', 'true');
  expect(f.pass2).toHaveAccessibleDescription(copy.crear.pass2Error);
  expect(posts(fetch)).toHaveLength(0);
});

test('con todo válido crea la cuenta y va al test de la sonda', async () => {
  const fetch = mockApi({
    'POST /galaxy/api/auth/register': () => jsonResponse(201, { id: '1', username: 'piloto_0123', roles: [], mfa: false }),
  });
  renderAt('/crear-cuenta', { '/crear-cuenta': <CrearCuenta /> });
  const user = userEvent.setup();
  const f = fields();
  await user.type(f.user, 'Piloto_0123');
  await user.type(f.pass, 'una-clave-larga');
  await user.type(f.pass2, 'una-clave-larga');
  await user.click(f.submit);
  expect(locationOf(await screen.findByTestId('location')).pathname).toBe('/sonda');
  expect(JSON.parse(String(posts(fetch)[0]![1]!.body))).toEqual({ username: 'Piloto_0123', password: 'una-clave-larga' });
});

// Referrals (plan «referidos»): a player who was invited types the code (or comes with it in the link), and when the
// game asks for one to sign up, the field says so and no account is asked for without it.
test('con el enlace de invitación el código ya está escrito y se envía', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/auth/signup-options': () => jsonResponse(200, { referralRequired: false }),
    'POST /galaxy/api/auth/register': () => jsonResponse(201, { id: '1', username: 'piloto_0123', roles: [], mfa: false }),
  });
  renderAt('/crear-cuenta?ref=vega-amigos', { '/crear-cuenta': <CrearCuenta /> });
  const user = userEvent.setup();
  const f = fields();
  expect(screen.getByLabelText(copy.crear.codeOptional)).toHaveValue('VEGA-AMIGOS');
  await user.type(f.user, 'Piloto_0123');
  await user.type(f.pass, 'una-clave-larga');
  await user.type(f.pass2, 'una-clave-larga');
  await user.click(f.submit);
  expect(locationOf(await screen.findByTestId('location')).pathname).toBe('/sonda');
  expect(JSON.parse(String(posts(fetch)[0]![1]!.body))).toEqual({ username: 'Piloto_0123', password: 'una-clave-larga', referralCode: 'VEGA-AMIGOS' });
});

test('si hace falta un código, sin él no se pide la cuenta', async () => {
  const fetch = mockApi({ 'GET /galaxy/api/auth/signup-options': () => jsonResponse(200, { referralRequired: true }) });
  renderAt('/crear-cuenta', { '/crear-cuenta': <CrearCuenta /> });
  const user = userEvent.setup();
  const f = fields();
  const code = await screen.findByLabelText(copy.crear.code);
  expect(code).toHaveAccessibleDescription(copy.crear.codeRequiredHint);
  await user.type(f.user, 'piloto_0123');
  await user.type(f.pass, 'una-clave-larga');
  await user.type(f.pass2, 'una-clave-larga');
  await user.click(f.submit);
  expect(code).toHaveAttribute('aria-invalid', 'true');
  expect(code).toHaveAccessibleDescription(copy.crear.codeError);
  expect(posts(fetch)).toHaveLength(0);
});

test('username_taken se muestra en la alerta del formulario', async () => {
  mockApi({ 'POST /galaxy/api/auth/register': () => jsonResponse(409, { error: 'username_taken' }) });
  renderAt('/crear-cuenta', { '/crear-cuenta': <CrearCuenta /> });
  const user = userEvent.setup();
  const f = fields();
  await user.type(f.user, 'ocupado_01');
  await user.type(f.pass, 'una-clave-larga');
  await user.type(f.pass2, 'una-clave-larga');
  await user.click(f.submit);
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.username_taken);
});
