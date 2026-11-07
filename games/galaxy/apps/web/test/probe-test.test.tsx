import { PROBE_TEST } from '@galaxy/shared';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { copy } from '../src/copy/es';
import { ProbeTestScreen } from '../src/probe-test/ProbeTest';
import { jsonResponse, locationOf, mockApi, renderAt } from './render';

// The probe test (GDD §6, §12.2): five questions one at a time, a tiebreak only when needed, then the reveal of the
// probe with its profile. Nothing is kept until it is sent: a reload starts again.

const answerFor = (q: number, probe: string) => PROBE_TEST.questions[q]!.answers.indexOf(probe as never);
const t = copy.probeTest;

function open() {
  renderAt('/sonda', { '/sonda': <ProbeTestScreen /> });
  fireEvent.click(screen.getByRole('button', { name: t.start }));
}
/** Picks answer `i` (0–2) of the question on screen with its number key. */
const press = (i: number) => fireEvent.keyDown(window, { key: String(i + 1), code: `Digit${i + 1}` });

beforeEach(() => localStorage.clear());

test('una pregunta cada vez, con su progreso y tres respuestas; elegir avanza y Atrás vuelve', () => {
  mockApi({});
  open();
  expect(screen.getByText(t.progress(1, 5))).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: t.questions[0]!.q })).toBeInTheDocument();
  expect(within(screen.getByRole('group', { name: t.questions[0]!.q })).getAllByRole('button')).toHaveLength(3);
  press(1);
  expect(screen.getByText(t.progress(2, 5))).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: t.questions[1]!.q })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: t.back }));
  expect(screen.getByRole('heading', { name: t.questions[0]!.q })).toBeInTheDocument();
});

test('sin empate envía las cinco respuestas y revela la sonda con su perfil', async () => {
  const fetch = mockApi({ 'POST /galaxy/api/probe-test': () => jsonResponse(200, { probe: 'bastion' }) });
  open();
  for (let q = 0; q < 5; q++) press(answerFor(q, 'bastion'));
  expect(await screen.findByRole('heading', { name: 'Bastión' })).toBeInTheDocument();
  expect(screen.getByText(t.profiles.bastion)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: t.toHangar })).toHaveAttribute('href', '/incursion');
  const sent = JSON.parse(String(fetch.mock.calls[0]![1]!.body));
  expect(sent).toEqual({ answers: [0, 1, 2, 3, 4].map((q) => answerFor(q, 'bastion')) });
});

test('con empate pregunta el desempate y lo envía con las otras cinco', async () => {
  const fetch = mockApi({ 'POST /galaxy/api/probe-test': () => jsonResponse(200, { probe: 'spark' }) });
  open();
  for (const [q, p] of [
    [0, 'lumen'],
    [1, 'lumen'],
    [2, 'bastion'],
    [3, 'bastion'],
    [4, 'spark'],
  ] as const)
    press(answerFor(q, p));
  expect(screen.getByRole('heading', { name: t.tiebreak.q })).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
  press(PROBE_TEST.tiebreak.answers.indexOf('spark'));
  expect(await screen.findByRole('heading', { name: 'Chispa' })).toBeInTheDocument();
  expect(JSON.parse(String(fetch.mock.calls[0]![1]!.body)).answers).toHaveLength(6);
});

test('si el envío falla se puede reintentar, con las mismas respuestas', async () => {
  let fail = true;
  const fetch = mockApi({ 'POST /galaxy/api/probe-test': () => (fail ? jsonResponse(500, { error: 'internal' }) : jsonResponse(200, { probe: 'lumen' })) });
  open();
  for (let q = 0; q < 5; q++) press(answerFor(q, 'lumen'));
  const retry = await screen.findByRole('button', { name: t.retry });
  fail = false;
  fireEvent.click(retry);
  expect(await screen.findByRole('heading', { name: 'Lumen' })).toBeInTheDocument();
  const bodies = fetch.mock.calls.map(([, init]) => JSON.parse(String(init!.body)));
  expect(bodies[0]).toEqual(bodies[1]);
});

test('saltar el test responde al azar y revela igualmente una de las tres', async () => {
  const fetch = mockApi({ 'POST /galaxy/api/probe-test': () => jsonResponse(200, { probe: 'lumen' }) });
  open();
  fireEvent.click(screen.getByRole('button', { name: t.skip }));
  expect(await screen.findByRole('heading', { name: 'Lumen' })).toBeInTheDocument();
  const sent = JSON.parse(String(fetch.mock.calls[0]![1]!.body)).answers as number[];
  expect(sent.length === 5 || sent.length === 6).toBe(true);
  expect(sent.every((a) => a >= 0 && a <= 2)).toBe(true);
});

test('recargar a mitad empieza de nuevo: no se guarda nada antes de enviar', () => {
  mockApi({});
  const first = renderAt('/sonda', { '/sonda': <ProbeTestScreen /> });
  fireEvent.click(screen.getByRole('button', { name: t.start }));
  press(0);
  press(0);
  first.unmount();
  renderAt('/sonda', { '/sonda': <ProbeTestScreen /> });
  expect(screen.getByRole('button', { name: t.start })).toBeInTheDocument();
  expect(localStorage.length).toBe(0);
});

test('Ir al hangar lleva al hangar', async () => {
  mockApi({ 'POST /galaxy/api/probe-test': () => jsonResponse(200, { probe: 'lumen' }) });
  open();
  for (let q = 0; q < 5; q++) press(answerFor(q, 'lumen'));
  await act(async () => {
    fireEvent.click(await screen.findByRole('link', { name: t.toHangar }));
  });
  expect(locationOf(await screen.findByTestId('location')).pathname).toBe('/incursion');
});
