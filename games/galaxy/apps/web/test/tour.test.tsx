import type { OnboardingView, TutorialView } from '@galaxy/shared';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { emitTour } from '../src/tour/bus';
import { chapterSteps, COUNTED } from '../src/tour/steps';
import { TourProvider } from '../src/tour/TourProvider';
import { jsonResponse, mockApi, renderAt } from './render';

// The guided tour (GDD §12.2; polish phase 3): PERKINS's cards, one step at a time, moved by «Siguiente», by what the
// player does or by where they go; skippable; a pill brings a wandering player back.
afterEach(() => vi.unstubAllGlobals());

const t = copy.tour;
const me = { id: 'a1', username: 'nuevo', roles: [] };
const fresh: OnboardingView = { probeTest: true, firstRun: false, welcomePulls: false, repairRoom: false, equipRelic: false };

function api(view: TutorialView, puts: unknown[] = []) {
  return mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, me),
    'GET /galaxy/api/tutorial': () => jsonResponse(200, view),
    'GET /galaxy/api/onboarding': () => jsonResponse(200, fresh),
    'PUT /galaxy/api/tutorial': (body) => {
      puts.push(body);
      const b = body as { action: string; chapter?: TutorialView['chapter'] };
      return jsonResponse(200, b.action === 'skip' ? { ...view, status: 'skipped' } : { ...view, chapter: b.chapter ?? view.chapter });
    },
  });
}

/** A screen with the marks the tour points at, and the tour over it. */
function Screen({ marks }: { marks: string[] }) {
  return (
    <>
      {marks.map((m) => (
        <button key={m} type="button" data-tour={m}>
          {m}
        </button>
      ))}
      <TourProvider />
    </>
  );
}

const card = () => screen.getByRole('dialog', { name: t.label });

test('las tarjetas del inicio avanzan con Siguiente y cuentan el progreso', async () => {
  api({ status: 'active', chapter: 'hub', gift: 0 });
  renderAt('/', { '/': <Screen marks={['wallet', 'play', 'home', 'scanner']} /> });
  expect(await screen.findByText(t.hub.hello)).toBeInTheDocument();
  expect(within(card()).getByText(t.count(1, COUNTED.length))).toBeInTheDocument();
  await userEvent.click(within(card()).getByRole('button', { name: t.next }));
  expect(await screen.findByText(t.hub.wallet)).toBeInTheDocument();
  expect(screen.getByText(t.count(2, COUNTED.length))).toBeInTheDocument();
});

test('un paso de acción no tiene Siguiente y deja usar lo señalado', async () => {
  api({ status: 'active', chapter: 'hub', gift: 0 });
  renderAt('/', { '/': <Screen marks={['wallet', 'play', 'home', 'scanner']} /> });
  for (const text of [t.hub.hello, t.hub.wallet, t.hub.play, t.hub.home]) {
    await screen.findByText(text);
    await userEvent.click(within(card()).getByRole('button', { name: t.next }));
  }
  const region = await screen.findByRole('region', { name: t.label });
  expect(within(region).getByText(t.hub.scanner)).toBeInTheDocument();
  expect(within(region).getByText(t.doIt)).toBeInTheDocument();
  expect(within(region).queryByRole('button', { name: t.next })).toBeNull();
});

test('saltar pide confirmación y lo guarda en el servidor', async () => {
  const puts: unknown[] = [];
  api({ status: 'active', chapter: 'hub', gift: 0 }, puts);
  renderAt('/', { '/': <Screen marks={[]} /> });
  await screen.findByText(t.hub.hello);
  await userEvent.click(within(card()).getByRole('button', { name: t.skip }));
  const ask = screen.getByRole('alertdialog', { name: t.skipTitle });
  // The card steps aside while asking (its veil would cover the question).
  expect(screen.queryByRole('dialog', { name: t.label })).toBeNull();
  await userEvent.click(within(ask).getByRole('button', { name: t.skipConfirm }));
  await vi.waitFor(() => expect(puts).toEqual([{ action: 'skip' }]));
  await vi.waitFor(() => expect(screen.queryByText(t.hub.hello)).toBeNull());
});

test('un paso que espera algo avanza cuando la pantalla lo cuenta', async () => {
  api({ status: 'active', chapter: 'scanner', gift: 0 });
  renderAt('/escaner', { '/escaner': <Screen marks={['odds', 'pity', 'pull10']} /> });
  for (const text of [t.scanner.odds, t.scanner.pity]) {
    await screen.findByText(text);
    await userEvent.click(within(card()).getByRole('button', { name: t.next }));
  }
  expect(await screen.findByText(t.scanner.pull)).toBeInTheDocument();
  act(() => emitTour('scanner:pulled'));
  expect(await screen.findByText(t.scanner.reveal)).toBeInTheDocument();
  act(() => emitTour('scanner:revealClosed'));
  expect(await screen.findByRole('button', { name: t.scanner.toHangar })).toBeInTheDocument();
});

test('terminar un capítulo lo cuenta al servidor y lo celebra', async () => {
  const puts: unknown[] = [];
  api({ status: 'active', chapter: 'run', gift: 0 }, puts);
  renderAt('/incursion', { '/incursion': <Screen marks={['loot']} /> });
  // The run's step is the arena's: no card, only the end of the run moves it.
  await new Promise((r) => setTimeout(r, 50));
  act(() => emitTour('run:ended'));
  await vi.waitFor(() => expect(puts).toEqual([{ action: 'advance', chapter: 'results' }]));
  expect(screen.getByRole('status')).toHaveTextContent(t.chapterDone(t.chapters.run ?? ''));
  expect(await screen.findByText(t.results.loot)).toBeInTheDocument();
});

test('si el jugador se va a otra pantalla, una píldora le lleva de vuelta', async () => {
  api({ status: 'active', chapter: 'station', gift: 10 });
  renderAt('/coleccion', { '/coleccion': <Screen marks={[]} /> });
  const pill = await screen.findByRole('link', { name: t.pill(t.places.station ?? '') });
  expect(pill).toHaveAttribute('href', '/estacion');
  expect(screen.queryByRole('dialog', { name: t.label })).toBeNull();
});

test('el tour no aparece si se saltó ni en el panel de administración', async () => {
  const fetch = api({ status: 'skipped', chapter: 'hub', gift: 0 });
  renderAt('/', { '/': <Screen marks={[]} /> });
  await vi.waitFor(() => expect(fetch.mock.calls.some(([url]) => url === '/galaxy/api/tutorial')).toBe(true));
  expect(screen.queryByText(t.hub.hello)).toBeNull();
  vi.unstubAllGlobals();
  api({ status: 'active', chapter: 'hub', gift: 0 });
  renderAt('/admin', { '/admin': <Screen marks={[]} /> });
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByText(t.hub.hello)).toBeNull();
});

// The welcome pulls are made by the very step that waits for the reveal to close: when the onboarding says they are
// done, that step must not vanish under the player (the chapter used to end, or restart on a reload).
test('el paso en el que estás no se salta aunque su condición se cumpla mientras', () => {
  const done = { ...fresh, welcomePulls: true };
  expect(chapterSteps('scanner', null, done).map((s) => s.id)).toEqual(['scan-odds', 'scan-pity', 'scan-relics']);
  expect(chapterSteps('scanner', 'scan-reveal', done).map((s) => s.id)).toEqual(['scan-odds', 'scan-pity', 'scan-reveal', 'scan-relics']);
  expect(chapterSteps('scanner', 'scan-reveal', fresh).map((s) => s.id)).toEqual(['scan-odds', 'scan-pity', 'scan-pull', 'scan-reveal', 'scan-relics']);
});

