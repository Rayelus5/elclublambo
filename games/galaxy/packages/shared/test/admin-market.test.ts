import { describe, expect, test } from 'vitest';
import { API_ERROR_CODES, adminAlertsQuerySchema, adminDealsQuerySchema, adminRevertSchema } from '../src/index';

// Trade moderation (GDD §16.4; M6c-2): what an admin may ask about listings, trades and alerts, and what a revert
// carries. Reverting asks for the admin's password; every list is paged.

describe('historial', () => {
  test('anuncios o trueques, con estado, cuenta y página opcionales', () => {
    expect(adminDealsQuerySchema.parse({ kind: 'listings' })).toEqual({ kind: 'listings', page: 1 });
    expect(adminDealsQuerySchema.parse({ kind: 'trades', status: 'done', user: 'vega', page: '3' })).toEqual({ kind: 'trades', status: 'done', user: 'vega', page: 3 });
    expect(adminDealsQuerySchema.parse({ kind: 'listings', status: 'sold' }).status).toBe('sold');
    expect(() => adminDealsQuerySchema.parse({ kind: 'galaxies' })).toThrow();
    expect(() => adminDealsQuerySchema.parse({ kind: 'listings', status: 'reverted' })).toThrow();
    expect(() => adminDealsQuerySchema.parse({ kind: 'listings', page: '0' })).toThrow();
  });

  test('el estado de un trueque es el suyo, no el de un anuncio', () => {
    expect(() => adminDealsQuerySchema.parse({ kind: 'trades', status: 'sold' })).toThrow();
    expect(() => adminDealsQuerySchema.parse({ kind: 'listings', status: 'done' })).toThrow();
  });
});

test('revertir pide motivo y contraseña', () => {
  expect(adminRevertSchema.parse({ reason: 'Venta entre cuentas de la misma IP', password: 'x' })).toEqual({ reason: 'Venta entre cuentas de la misma IP', password: 'x' });
  expect(() => adminRevertSchema.parse({ reason: 'Fraude' })).toThrow();
  expect(() => adminRevertSchema.parse({ reason: 'no', password: 'x' })).toThrow();
});

test('las alertas se filtran por revisadas o pendientes, con página', () => {
  expect(adminAlertsQuerySchema.parse({})).toEqual({ page: 1 });
  expect(adminAlertsQuerySchema.parse({ reviewed: 'false', page: '2' })).toEqual({ reviewed: false, page: 2 });
  expect(adminAlertsQuerySchema.parse({ reviewed: 'true' }).reviewed).toBe(true);
  expect(() => adminAlertsQuerySchema.parse({ reviewed: 'quizá' })).toThrow();
});

test('los errores nuevos del comercio existen', () => {
  for (const code of ['revert_blocked', 'already_reverted', 'alert_reviewed'] as const) expect(API_ERROR_CODES).toContain(code);
});
