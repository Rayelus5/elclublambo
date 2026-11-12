import { expect, test } from 'vitest';
import { againPlan } from '../src/scanner/again';

// «¡Escanear otra!» (Nov plan A1): the same scan again, paid the same way; after the daily free one it never asks for
// another free scan (the server would answer free_pull_used) and says what is missing when the balance falls short.
const costs = { coins: 100, coinsTen: 900, signals: 1 };

test('tras el gratis, con señales paga con señales', () => {
  expect(againPlan(1, 'free', costs, 3, 0)).toEqual({ count: 1, pay: 'signal', cost: 1, currency: 'signal', missing: 0 });
});

test('tras el gratis, sin señales pero con monedas paga con monedas', () => {
  expect(againPlan(1, 'free', costs, 0, 150)).toEqual({ count: 1, pay: 'coins', cost: 100, currency: 'coins', missing: 0 });
});

test('tras el gratis, sin nada pide señales y dice cuánto falta', () => {
  expect(againPlan(1, 'free', costs, 0, 0)).toEqual({ count: 1, pay: 'signal', cost: 1, currency: 'signal', missing: 1 });
});

test('repite con monedas el escaneo de 10 y dice lo que falta', () => {
  expect(againPlan(10, 'coins', costs, 50, 500)).toEqual({ count: 10, pay: 'coins', cost: 900, currency: 'coins', missing: 400 });
});

test('repite con señales el escaneo de 10 aunque haya monedas', () => {
  expect(againPlan(10, 'signal', costs, 10, 5000)).toEqual({ count: 10, pay: 'signal', cost: 10, currency: 'signal', missing: 0 });
});
