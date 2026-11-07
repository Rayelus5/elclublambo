import { expect, test } from 'vitest';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { parseConfig } from '../src/index';

test('features y auth tienen valores por defecto', () => {
  expect(parseConfig('features', {})).toEqual({ registrationOpen: true, maintenance: false, gacha: true, runs: true });
  expect(parseConfig('auth', {})).toEqual({
    sessionDays: 30,
    adminSessionHours: 12,
    registerPerIpHour: 5,
    loginPerIpTenMin: 30,
    loginPerUserTenMin: 10,
    totpPerAccountTenMin: 10,
    resetRedeemPerIpHour: 10,
  });
});

test('auth rechaza valores fuera de rango o no enteros', () => {
  expect(() => parseConfig('auth', { sessionDays: 0 })).toThrow();
  expect(() => parseConfig('auth', { sessionDays: 91 })).toThrow();
  expect(() => parseConfig('auth', { adminSessionHours: 73 })).toThrow();
  expect(() => parseConfig('auth', { registerPerIpHour: 1001 })).toThrow();
  expect(() => parseConfig('auth', { loginPerIpTenMin: 2.5 })).toThrow();
});

test('features rechaza tipos incorrectos y conserva los valores dados', () => {
  expect(() => parseConfig('features', { maintenance: 'sí' })).toThrow();
  expect(parseConfig('features', { maintenance: true })).toEqual({ registrationOpen: true, maintenance: true, gacha: true, runs: true });
});

test('una clave desconocida lanza', () => {
  expect(() => parseConfig('nada' as never, {})).toThrow();
});

test('una clave mal escrita o desconocida no se acepta (revisión final I3)', () => {
  expect(() => parseConfig('features', { maintenance: true, regstrationOpen: false })).toThrow();
  expect(() => parseConfig('auth', { sesionDays: 31 })).toThrow();
});

test('content toma el contenido de las incursiones por defecto (GDD §13.1 bis)', () => {
  expect(parseConfig('content', {})).toEqual(DEFAULT_CONTENT);
});

test('runs tiene los valores de partida de la economía de las incursiones', () => {
  expect(parseConfig('runs', {})).toEqual({
    depth: { table: [1, 1.5, 2.2, 3], step: 0.8 },
    deathShare: 0.5,
    daily: { hours: [3, 4, 5], multipliers: [1, 0.75, 0.5, 0.25] },
    signalChancePerBoss: 0.1,
    caps: { killsPerMinute: 600, coinsPerKill: 0.25, dustPerKill: 0.12, bossCoins: 30, bossDust: 10, slackSeconds: 20 },
    expireHours: 24,
    startPerHour: 30,
  });
});

test('runs rechaza tramos diarios que no crecen o multiplicadores que suben', () => {
  expect(() => parseConfig('runs', { daily: { hours: [3, 3, 5], multipliers: [1, 0.75, 0.5, 0.25] } })).toThrow(/daily_hours_increasing/);
  expect(() => parseConfig('runs', { daily: { hours: [3, 4, 5], multipliers: [1, 0.75, 0.9, 0.25] } })).toThrow(/daily_multipliers_decreasing/);
  expect(() => parseConfig('runs', { daily: { hours: [3, 4], multipliers: [1, 0.75, 0.5, 0.25] } })).toThrow(/daily_shape/);
  expect(() => parseConfig('runs', { deathShare: 1.5 })).toThrow();
});
