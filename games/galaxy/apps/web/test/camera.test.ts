import { expect, test } from 'vitest';
import { cameraFor } from '../src/arena/stage/camera';

// The arena camera (GDD §17.2, DESIGN_SYSTEM §8 quater): whole-number zoom for crisp pixels, about 340 units of
// height whatever the monitor, and never more than 21:9 of width — wider screens get side bars, not more view.

const at = { x: 0, y: 0 };

test('1280×720 y 1920×1080: zoom 2 y 3, la misma vista de 640×360 y sin bandas', () => {
  expect(cameraFor(1280, 720, at, 0)).toMatchObject({ zoom: 2, worldW: 640, worldH: 360, bars: 0 });
  expect(cameraFor(1920, 1080, at, 0)).toMatchObject({ zoom: 3, worldW: 640, worldH: 360, bars: 0 });
});

test('una ultrapanorámica no ve más de 21:9: el resto son bandas', () => {
  const c = cameraFor(3440, 1440, at, 0);
  expect(c.zoom).toBe(4);
  expect(c.worldH).toBe(360);
  expect(c.worldW).toBe(840);
  expect(c.bars).toBe(40);
  expect(cameraFor(2560, 1080, at, 0)).toMatchObject({ zoom: 3, worldW: 840, bars: 20 });
});

test('la visión de una reliquia puede bajar el zoom un punto para ver más', () => {
  expect(cameraFor(1920, 1200, at, 0).zoom).toBe(4);
  expect(cameraFor(1920, 1200, at, 0.08).zoom).toBe(3);
});

test('la cámara sigue al foco en píxeles de pantalla enteros', () => {
  const c = cameraFor(1920, 1080, { x: 10.2, y: -4.4 }, 0);
  expect(c.x * c.zoom).toBe(Math.round(10.2 * 3));
  expect(c.y * c.zoom).toBe(Math.round(-4.4 * 3));
});
