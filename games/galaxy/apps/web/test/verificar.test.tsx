import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { Verificar } from '../src/routes/Verificar';
import { jsonResponse, locationOf, mockApi, renderAt } from './render';

afterEach(() => vi.unstubAllGlobals());

test('sin desafío en el estado vuelve a /entrar', async () => {
  mockApi({});
  renderAt('/verificar', { '/verificar': <Verificar /> });
  expect(locationOf(await screen.findByTestId('location')).pathname).toBe('/entrar');
});

test('el código es de una sola casilla con autocompletado de un solo uso y solo guarda 6 cifras', async () => {
  mockApi({});
  renderAt('/verificar', { '/verificar': <Verificar /> }, { challenge: 'chal-1' });
  const input = screen.getByLabelText('Código');
  expect(input).toHaveAttribute('autocomplete', 'one-time-code');
  expect(input).toHaveAttribute('inputmode', 'numeric');
  const submit = screen.getByRole('button', { name: 'Verificar' });
  expect(submit).toBeDisabled();
  await userEvent.setup().type(input, '12a3456789');
  expect(input).toHaveValue('123456');
  expect(submit).toBeEnabled();
});

test('se puede pegar el código', async () => {
  mockApi({});
  renderAt('/verificar', { '/verificar': <Verificar /> }, { challenge: 'chal-1' });
  const input = screen.getByLabelText('Código');
  const user = userEvent.setup();
  await user.click(input);
  await user.paste('654 321');
  expect(input).toHaveValue('654321');
});

test('envía desafío y código; un código malo muestra la alerta', async () => {
  const fetch = mockApi({ 'POST /galaxy/api/auth/totp': () => jsonResponse(401, { error: 'invalid_totp' }) });
  renderAt('/verificar', { '/verificar': <Verificar /> }, { challenge: 'chal-1' });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Código'), '123456');
  await user.click(screen.getByRole('button', { name: 'Verificar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.invalid_totp);
  expect(JSON.parse(String(fetch.mock.calls[0]![1]!.body))).toEqual({ challenge: 'chal-1', code: '123456' });
});

test('un código bueno lleva a la portada', async () => {
  mockApi({
    'POST /galaxy/api/auth/totp': () => jsonResponse(200, { id: '1', username: 'adm', roles: ['admin'], mfa: true }),
  });
  renderAt('/verificar', { '/verificar': <Verificar /> }, { challenge: 'chal-1' });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Código'), '123456');
  await user.click(screen.getByRole('button', { name: 'Verificar' }));
  expect(locationOf(await screen.findByTestId('location')).pathname).toBe('/');
});
