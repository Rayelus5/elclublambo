import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Link, Route, Routes } from 'react-router';
import { beforeEach, expect, test } from 'vitest';
import { BackLink, backLabel, HomeLink } from '../src/ui/BackLink';
import { nextTrail, resetTrail, screenOf, TrailTracker } from '../src/ui/trail';
import { LocationProbe, locationOf } from './render';

// «Volver» goes to the real previous screen (M6d-1, the owner's request): the game keeps a trail of the screens visited
// (a card's detail dialog counts as its collection), and «Volver» leads to the one before; arriving straight by
// address it goes where it always went.
beforeEach(() => resetTrail());

test('el rastro apila pantallas nuevas, no repite la misma y retrocede al volver a la anterior', () => {
  let t = nextTrail([], '/', '/');
  t = nextTrail(t, '/estacion', '/estacion');
  t = nextTrail(t, '/escaner', '/escaner');
  expect(t.map((s) => s.screen)).toEqual(['/', '/estacion', '/escaner']);
  t = nextTrail(t, '/escaner', '/escaner?x=1');
  expect(t.at(-1)).toEqual({ screen: '/escaner', href: '/escaner?x=1' });
  t = nextTrail(t, '/estacion', '/estacion');
  expect(t.map((s) => s.screen)).toEqual(['/', '/estacion']);
});

test('subir a la pantalla madre (de /incursion/grupo a /incursion) es volver, aunque se llegara al grupo directo', () => {
  // A reload on the group page (or arriving there by address): the trail starts there.
  let t = nextTrail([], '/incursion/grupo', '/incursion/grupo');
  t = nextTrail(t, '/incursion', '/incursion');
  // The hangar's «Volver» has nothing before it: it goes to its own fallback (the title), not back to the group page.
  expect(t.map((s) => s.screen)).toEqual(['/incursion']);
  // Only what hangs below the screen is dropped: a profile visited in between stays as the step before.
  let u = nextTrail([], '/incursion/grupo', '/incursion/grupo');
  u = nextTrail(u, '/perfil/vega', '/perfil/vega');
  u = nextTrail(u, '/incursion', '/incursion');
  expect(u.map((s) => s.screen)).toEqual(['/incursion/grupo', '/perfil/vega', '/incursion']);
  // A room page under the group: back to the hangar drops both.
  let w = nextTrail([], '/', '/');
  w = nextTrail(w, '/incursion/grupo', '/incursion/grupo');
  w = nextTrail(w, '/incursion/sala', '/incursion/sala');
  w = nextTrail(w, '/incursion', '/incursion');
  expect(w.map((s) => s.screen)).toEqual(['/', '/incursion']);
});

test('el detalle de una carta es la misma pantalla que su colección', () => {
  expect(screenOf('/coleccion/abc')).toBe('/coleccion');
  expect(screenOf('/coleccion')).toBe('/coleccion');
  expect(screenOf('/clanes/GX')).toBe('/clanes/GX');
  expect(screenOf('/perfil/vega/coleccion')).toBe('/perfil/vega/coleccion');
});

function app(initial: string) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <TrailTracker />
      <Routes>
        <Route path="/" element={<Link to="/estacion">Hogar</Link>} />
        <Route
          path="/estacion"
          element={
            <>
              <Link to="/escaner">Escáner</Link>
              <BackLink fallback="/">Volver</BackLink>
            </>
          }
        />
        <Route
          path="/escaner"
          element={
            <>
              <Link to="/coleccion/g1">Una carta</Link>
              <BackLink fallback="/">Volver</BackLink>
            </>
          }
        />
        <Route path="/coleccion/:id" element={<Link to="/escaner">Cerrar</Link>} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

test('Hogar, Escáner y Volver lleva al Hogar; y desde el Hogar, Volver lleva al inicio', async () => {
  app('/');
  await userEvent.click(screen.getByRole('link', { name: 'Hogar' }));
  await userEvent.click(screen.getByRole('link', { name: 'Escáner' }));
  await userEvent.click(screen.getByRole('link', { name: 'Volver' }));
  expect(locationOf(screen.getByTestId('location')).pathname).toBe('/estacion');
  await userEvent.click(screen.getByRole('link', { name: 'Volver' }));
  expect(locationOf(screen.getByTestId('location')).pathname).toBe('/');
});

test('entrando directamente por la dirección, Volver va a donde siempre', async () => {
  app('/escaner');
  expect(screen.getByRole('link', { name: 'Volver' })).toHaveAttribute('href', '/');
});

test('«Volver al inicio» lleva siempre al inicio, venga de donde venga (el aviso del dueño)', async () => {
  render(
    <MemoryRouter initialEntries={['/clasificacion']}>
      <TrailTracker />
      <Routes>
        <Route path="/clasificacion" element={<Link to="/perfil/vega">Vega</Link>} />
        <Route path="/perfil/:u" element={<HomeLink>Volver al inicio</HomeLink>} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByRole('link', { name: 'Vega' }));
  expect(screen.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/');
});

test('el botón dice adónde lleva: la pantalla anterior real, o la de siempre si se entró directo', async () => {
  render(
    <MemoryRouter initialEntries={['/estacion']}>
      <TrailTracker />
      <Routes>
        <Route path="/estacion" element={<Link to="/codice">Códice</Link>} />
        <Route path="/codice" element={<BackLink fallback="/estacion" />} />
        <Route path="/perfil/:u" element={<Link to="/perfil/vega/coleccion">Su colección</Link>} />
        <Route path="/perfil/:u/coleccion" element={<BackLink fallback="/perfil/vega" />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByRole('link', { name: 'Códice' }));
  expect(screen.getByRole('link', { name: 'Volver a la estación' })).toHaveAttribute('href', '/estacion');
});

test('la etiqueta nombra cada destino, también los de un jugador', () => {
  expect(backLabel('/')).toBe('Volver al inicio');
  expect(backLabel('/incursion')).toBe('Volver al hangar');
  expect(backLabel('/coleccion?tipo=spiral')).toBe('Volver a la colección');
  expect(backLabel('/perfil/vega')).toBe('Volver al perfil de vega');
  expect(backLabel('/perfil/vega/coleccion')).toBe('Volver a la colección de vega');
  expect(backLabel('/planetario/vega')).toBe('Volver al planetario de vega');
  expect(backLabel('/clanes/GX')).toBe('Volver al clan');
  expect(backLabel('/algo-nuevo')).toBe('Volver');
});

test('una página que cuelga de otra vuelve siempre a su madre (la sala, al hangar), venga de donde venga', async () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <TrailTracker />
      <Routes>
        <Route path="/" element={<Link to="/incursion/sala">Unirse</Link>} />
        <Route path="/incursion/sala" element={<BackLink to="/incursion" />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByRole('link', { name: 'Unirse' }));
  expect(screen.getByRole('link', { name: 'Volver al hangar' })).toHaveAttribute('href', '/incursion');
});
