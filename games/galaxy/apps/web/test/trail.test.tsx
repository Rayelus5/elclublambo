import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Link, Route, Routes } from 'react-router';
import { beforeEach, expect, test } from 'vitest';
import { BackLink, HomeLink } from '../src/ui/BackLink';
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
