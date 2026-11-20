import { expect, test } from 'vitest';
import { cameraFor, wheelSteps, zoomSteps } from '../src/arena/stage/camera';

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

test('la rueda acerca la vista a pasos enteros, hasta el doble de cerca; nunca aleja más que la vista de siempre', () => {
  expect(zoomSteps(2)).toBe(2);
  expect(zoomSteps(3)).toBe(3);
  expect(zoomSteps(4)).toBe(4);
  expect(zoomSteps(1)).toBe(1);
  expect(cameraFor(1920, 1080, at, 0, 1)).toMatchObject({ zoom: 4, worldH: 270, worldW: 480 });
  expect(cameraFor(1920, 1080, at, 0, 3)).toMatchObject({ zoom: 6, worldH: 180 });
  expect(cameraFor(1920, 1080, at, 0, 9).zoom).toBe(6);
  expect(cameraFor(1920, 1080, at, 0, -2).zoom).toBe(3);
  expect(cameraFor(1280, 720, at, 0, 2).zoom).toBe(4);
  // With a relic's wider view the steps start from its own base zoom.
  expect(cameraFor(1920, 1200, at, 0.08, 1).zoom).toBe(4);
});

test('una muesca del ratón es un paso; los toques pequeños del trackpad se suman hasta hacer uno', () => {
  expect(wheelSteps(0, { deltaY: -100, deltaMode: 0 })).toEqual({ steps: 1, rest: 0 });
  expect(wheelSteps(0, { deltaY: 120, deltaMode: 0 })).toEqual({ steps: -1, rest: 20 });
  expect(wheelSteps(0, { deltaY: -3, deltaMode: 1 })).toEqual({ steps: 1, rest: -20 });
  let rest = 0;
  let steps = 0;
  for (let i = 0; i < 9; i++) {
    const r = wheelSteps(rest, { deltaY: -12, deltaMode: 0 });
    rest = r.rest;
    steps += r.steps;
  }
  expect(steps).toBe(1);
});

test('con SHIFT pulsado (el dash) la rueda va de lado y sigue acercando', () => {
  expect(wheelSteps(0, { deltaY: 0, deltaX: -100, shiftKey: true, deltaMode: 0 }).steps).toBe(1);
  expect(wheelSteps(0, { deltaY: 0, deltaX: -100, shiftKey: false, deltaMode: 0 }).steps).toBe(0);
  expect(wheelSteps(0, { deltaY: 100, deltaMode: 0 }).steps).toBe(-1);
});
