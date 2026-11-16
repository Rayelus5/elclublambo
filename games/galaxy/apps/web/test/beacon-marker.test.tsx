import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { BeaconMarker, EventMarker } from '../src/arena/hud/Overlays';
import { copy } from '../src/copy/es';

// The beacon's marker is measured from where the camera looks (Nov plan A2): out until the next layer, the camera
// follows a teammate, and the beacon next to them is on screen even if it is far from my own probe.
const beacon = { x: 1000, y: 0, dx: 4000, dy: 0, hold: 0, holdNeeded: 8, left: 50 };

test('la baliza junto al compañero que miro sale en pantalla, no en el borde', () => {
  const { container } = render(<BeaconMarker beacon={beacon} camera={{ x: 990, y: 0, zoom: 2, bars: 0 } as never} width={1280} height={720} />);
  expect(container.querySelector('.hud-beacon')).toHaveClass('here');
});

test('sin cámara usa la distancia a mi sonda', () => {
  const { container } = render(<BeaconMarker beacon={beacon} camera={null} width={1280} height={720} />);
  expect(container.querySelector('.hud-beacon')).not.toHaveClass('here');
});

test('la distancia que dice también se mide desde donde mira la cámara', () => {
  const { container } = render(<BeaconMarker beacon={beacon} camera={{ x: 990, y: 0, zoom: 2, bars: 0 } as never} width={1280} height={720} />);
  expect(container.querySelector('.hud-beacon')).toHaveTextContent(copy.arena.beaconDistance(10));
});

// Something to go for (a satellite, the in-run events, 2026-11-16): off screen, its name, what to do, how far it is and
// the seconds it has left; on screen, nothing, unless it is a ship being looted.
const ev = copy.arena.events;

test('un evento fuera de la pantalla dice qué es, qué hacer, a qué distancia y cuánto le queda', () => {
  const { container } = render(<EventMarker event={{ kind: 'bounty', dx: 900, dy: 0, left: 31.2 }} camera={null} width={1280} height={720} />);
  const marker = container.querySelector('.hud-event.bounty');
  expect(marker).not.toHaveClass('here');
  expect(marker).toHaveTextContent(ev.bounty.name);
  expect(marker).toHaveTextContent(`${ev.bounty.hint} · ${copy.arena.beaconDistance(900)} · ${ev.left(32)}`);
});

test('el satélite también dice su distancia', () => {
  const { container } = render(<EventMarker event={{ kind: 'satellite', dx: 0, dy: -700 }} camera={null} width={1280} height={720} />);
  expect(container.querySelector('.hud-event.satellite')).toHaveTextContent(copy.arena.beaconDistance(700));
});

test('en pantalla no dice nada, salvo la nave que se está saqueando', () => {
  const near = render(<EventMarker event={{ kind: 'capsule', dx: 40, dy: 0, left: 20 }} camera={null} width={1280} height={720} />);
  expect(near.container.querySelector('.hud-event')).toBeNull();
  const looting = render(<EventMarker event={{ kind: 'wreck', dx: 40, dy: 0, left: 20, progress: 0.5 }} camera={null} width={1280} height={720} />);
  expect(looting.container.querySelector('.hud-event.wreck')).toHaveClass('here');
  expect(looting.container.querySelector('.hud-event.wreck')).toHaveTextContent(ev.looting(50));
});

