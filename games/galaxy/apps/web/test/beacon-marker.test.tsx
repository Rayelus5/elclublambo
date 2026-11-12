import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { BeaconMarker } from '../src/arena/hud/Overlays';
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
