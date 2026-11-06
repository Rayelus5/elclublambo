import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { Entrar } from '../src/routes/Entrar';
import { jsonResponse, locationOf, mockApi, renderAt } from './render';

afterEach(() => vi.unstubAllGlobals());

async function fillAndSubmit(username = 'SonDa_Rayo', password = 'una-clave-larga') {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Usuario'), username);
  await user.type(screen.getByLabelText('Contraseña'), password);
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
}

test('título y campos con autocompletado del gestor de contraseñas', () => {
  mockApi({});
  renderAt('/entrar', { '/entrar': <Entrar /> });
  expect(screen.getByRole('heading', { name: copy.entrar.title })).toBeInTheDocument();
  expect(screen.getByLabelText('Usuario')).toHaveAttribute('autocomplete', 'username');
  expect(screen.getByLabelText('Contraseña')).toHaveAttribute('autocomplete', 'current-password');
});

test('invalid_credentials muestra su texto en la alerta del formulario y le da el foco', async () => {
  const fetch = mockApi({ 'POST /galaxy/api/auth/login': () => jsonResponse(401, { error: 'invalid_credentials' }) });
  renderAt('/entrar', { '/entrar': <Entrar /> });
  await fillAndSubmit();
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(copy.errors.invalid_credentials);
  expect(alert).toHaveFocus();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(fetch.mock.calls[0]![1]!.body))).toEqual({ username: 'SonDa_Rayo', password: 'una-clave-larga' });
});

test('totp_required lleva a /verificar con el desafío en el estado, nunca en la URL', async () => {
  mockApi({ 'POST /galaxy/api/auth/login': () => jsonResponse(200, { status: 'totp_required', challenge: 'chal-123' }) });
  renderAt('/entrar', { '/entrar': <Entrar /> });
  await fillAndSubmit();
  const loc = locationOf(await screen.findByTestId('location'));
  expect(loc.pathname).toBe('/verificar');
  expect(loc.search).toBe('');
  expect(loc.state).toEqual({ challenge: 'chal-123' });
});

test('status ok lleva a la portada', async () => {
  mockApi({
    'POST /galaxy/api/auth/login': () =>
      jsonResponse(200, { status: 'ok', me: { id: '1', username: 'sonda_rayo', roles: [], mfa: false } }),
  });
  renderAt('/entrar', { '/entrar': <Entrar /> });
  await fillAndSubmit();
  expect(locationOf(await screen.findByTestId('location')).pathname).toBe('/');
});

test('campos vacíos no llaman a la API y marcan el campo', async () => {
  const fetch = mockApi({});
  renderAt('/entrar', { '/entrar': <Entrar /> });
  await userEvent.setup().click(screen.getByRole('button', { name: 'Entrar' }));
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Usuario')).toHaveAttribute('aria-invalid', 'true');
});
