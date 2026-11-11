import { expect, test } from 'vitest';
import { between, centered, fitted, lodOf, nearestIn, ZOOM_MAX, ZOOM_MIN, zoomed } from '../src/lab/board/camera';

// The whiteboard's camera (shop and lab plan, F3): zooming keeps the point under the cursor still and stays within its
// limits, a fit shows the box whole and centred, the level of detail follows the zoom, and the arrow keys go to the
// nearest node that way.

test('acercar mantiene quieto el punto bajo el cursor y respeta los límites', () => {
  const cam = { x: 100, y: 50, k: 1 };
  const z = zoomed(cam, 2, 400, 300);
  // The world point under the cursor before and after.
  expect((400 - cam.x) / cam.k).toBeCloseTo((400 - z.x) / z.k, 9);
  expect((300 - cam.y) / cam.k).toBeCloseTo((300 - z.y) / z.k, 9);
  expect(zoomed(cam, 100, 0, 0).k).toBe(ZOOM_MAX);
  expect(zoomed(cam, 0.001, 0, 0).k).toBe(ZOOM_MIN);
});

test('encajar enseña la caja entera y centrada', () => {
  const c = fitted({ minX: -500, minY: -300, maxX: 500, maxY: 300 }, { w: 1200, h: 800 }, 0);
  expect(c.k).toBeCloseTo(1.2, 9);
  expect(c.x).toBeCloseTo(600, 9);
  expect(c.y).toBeCloseTo(400, 9);
  const mid = centered({ x: 0, y: 0, k: 2 }, { x: 10, y: 20 }, { w: 1000, h: 600 });
  expect(mid).toEqual({ k: 2, x: 480, y: 260 });
  expect(between({ x: 0, y: 0, k: 1 }, { x: 10, y: 10, k: 2 }, 1)).toEqual({ x: 10, y: 10, k: 2 });
});

test('el nivel de detalle sigue al zoom', () => {
  expect(lodOf(0.35)).toBe('far');
  expect(lodOf(0.6)).toBe('mid');
  expect(lodOf(1.4)).toBe('near');
});

test('las flechas van al nodo más cercano en esa dirección', () => {
  const nodes = [
    { id: 'c', x: 0, y: 0 },
    { id: 'r', x: 100, y: 10 },
    { id: 'far-r', x: 300, y: 0 },
    { id: 'u', x: 5, y: -120 },
  ];
  expect(nearestIn(nodes, nodes[0]!, 'right')?.id).toBe('r');
  expect(nearestIn(nodes, nodes[0]!, 'up')?.id).toBe('u');
  expect(nearestIn(nodes, nodes[0]!, 'left')).toBeNull();
});
