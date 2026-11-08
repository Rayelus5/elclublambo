import { describe, expect, test } from 'vitest';
import {
  ADMIN_SECTIONS,
  API_ERROR_CODES,
  adminBanSchema,
  adminGalaxyGrantSchema,
  adminGalaxyRevokeSchema,
  adminRenameSchema,
  adminSearchSchema,
  adminWalletSchema,
  adminXpSchema,
  auditQuerySchema,
} from '../src/index';

// The admin panel's players and audit (GDD §16.1, §16.2; M6a): what an admin may send. Every change has a reason; the
// destructive ones also carry the admin's password; amounts and dates are bounded.

describe('cambios a un jugador', () => {
  test('la cartera: una moneda conocida, una cantidad distinta de 0 y un motivo; quitar pide la contraseña', () => {
    expect(adminWalletSchema.parse({ currency: 'coins', amount: 500, reason: 'Compensación' })).toEqual({ currency: 'coins', amount: 500, reason: 'Compensación' });
    expect(() => adminWalletSchema.parse({ currency: 'coins', amount: 0, reason: 'nada' })).toThrow();
    expect(() => adminWalletSchema.parse({ currency: 'gold', amount: 5, reason: 'nada' })).toThrow();
    expect(() => adminWalletSchema.parse({ currency: 'coins', amount: 5, reason: 'no' })).toThrow();
    expect(() => adminWalletSchema.parse({ currency: 'coins', amount: -5, reason: 'Corrección' })).toThrow();
    expect(adminWalletSchema.parse({ currency: 'dust', amount: -5, reason: 'Corrección', password: 'x' }).amount).toBe(-5);
  });

  test('conceder una galaxia elige rareza y acabado, y la semilla si se quiere', () => {
    expect(adminGalaxyGrantSchema.parse({ tier: 'epic', finish: 'holo', reason: 'Premio del torneo' })).toEqual({ tier: 'epic', finish: 'holo', reason: 'Premio del torneo' });
    expect(adminGalaxyGrantSchema.parse({ tier: 'rare', finish: 'normal', seed: '18446744073709551615', reason: 'Reposición' }).seed).toBe('18446744073709551615');
    expect(() => adminGalaxyGrantSchema.parse({ tier: 'mythic', finish: 'normal', reason: 'Premio' })).toThrow();
    expect(() => adminGalaxyGrantSchema.parse({ tier: 'rare', finish: 'normal', seed: '-1', reason: 'Premio' })).toThrow();
  });

  test('lo destructivo pide contraseña: retirar, experiencia, nombre y baneo', () => {
    expect(() => adminGalaxyRevokeSchema.parse({ reason: 'Duplicada' })).toThrow();
    expect(() => adminXpSchema.parse({ xp: 100, reason: 'Ajuste' })).toThrow();
    expect(() => adminRenameSchema.parse({ username: 'nuevo_nombre', reason: 'Ofensivo' })).toThrow();
    expect(() => adminBanSchema.parse({ minutes: 60, reason: 'Trampas' })).toThrow();
    expect(adminBanSchema.parse({ minutes: null, reason: 'Trampas', password: 'x' })).toEqual({ minutes: null, reason: 'Trampas', password: 'x' });
    expect(() => adminBanSchema.parse({ minutes: 0, reason: 'Trampas', password: 'x' })).toThrow();
    expect(() => adminRenameSchema.parse({ username: 'a', reason: 'Ofensivo', password: 'x' })).toThrow();
  });
});

describe('buscar y auditar', () => {
  test('la búsqueda es un texto corto', () => {
    expect(adminSearchSchema.parse({ q: ' vega ' })).toEqual({ q: 'vega' });
    expect(() => adminSearchSchema.parse({ q: '' })).toThrow();
  });

  test('el registro se filtra por quién, qué, a quién y fechas, por páginas', () => {
    expect(auditQuerySchema.parse({})).toEqual({ page: 1 });
    expect(auditQuerySchema.parse({ actor: 'rayelus', action: 'player.ban', from: '2026-11-01', page: '3' })).toEqual({ actor: 'rayelus', action: 'player.ban', from: '2026-11-01', page: 3 });
    expect(() => auditQuerySchema.parse({ from: 'ayer' })).toThrow();
  });

  test('las secciones de un jugador y sus errores', () => {
    expect(ADMIN_SECTIONS).toEqual(['galaxies', 'ledger', 'pulls', 'runs', 'market', 'chat']);
    for (const code of ['password_wrong', 'player_not_found']) expect(API_ERROR_CODES).toContain(code);
  });
});
