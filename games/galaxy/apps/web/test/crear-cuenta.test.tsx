import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { CrearCuenta } from '../src/routes/CrearCuenta';
import { jsonResponse, locationOf, mockApi, renderAt } from './render';

afterEach(() => vi.unstubAllGlobals());

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
  expect(fetch).not.toHaveBeenCalled();
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
  expect(JSON.parse(String(fetch.mock.calls[0]![1]!.body))).toEqual({ username: 'Piloto_0123', password: 'una-clave-larga' });
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
