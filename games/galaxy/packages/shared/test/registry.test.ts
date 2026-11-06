import { expect, test } from 'vitest';
import { parseConfig } from '../src/index';

test('features y auth tienen valores por defecto', () => {
  expect(parseConfig('features', {})).toEqual({ registrationOpen: true, maintenance: false, gacha: true });
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
  expect(parseConfig('features', { maintenance: true })).toEqual({ registrationOpen: true, maintenance: true, gacha: true });
});

test('una clave desconocida lanza', () => {
  expect(() => parseConfig('nada' as never, {})).toThrow();
});

test('una clave mal escrita o desconocida no se acepta (revisión final I3)', () => {
  expect(() => parseConfig('features', { maintenance: true, regstrationOpen: false })).toThrow();
  expect(() => parseConfig('auth', { sesionDays: 31 })).toThrow();
});
