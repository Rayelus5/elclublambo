import { expect, test } from 'vitest';
import { bestValue, PULL_COUNTS, pullCost } from '../src/index';

// What a pull costs (2026-11-17, the owner: «tiradas de 5»): with coins each size has its own price (x5 and x10 are
// cheaper per scan), with signals it is one per scan; the free one is the daily x1. «Mejor precio» marks the size that
// costs least per scan, only when it really is cheaper.

const costs = { coins: 100, coinsFive: 475, coinsTen: 900, signals: 1 };

test('las tiradas son de 1, 5 o 10', () => {
  expect(PULL_COUNTS).toEqual([1, 5, 10]);
});

test('con monedas cada tamaño tiene su precio; con señales, una por escaneo', () => {
  expect(pullCost(costs, 1, 'coins')).toBe(100);
  expect(pullCost(costs, 5, 'coins')).toBe(475);
  expect(pullCost(costs, 10, 'coins')).toBe(900);
  expect(pullCost(costs, 5, 'signal')).toBe(5);
  expect(pullCost({ ...costs, signals: 2 }, 10, 'signal')).toBe(20);
  expect(pullCost(costs, 1, 'free')).toBe(0);
});

test('«Mejor precio» es el tamaño más barato por escaneo, y solo si de verdad ahorra', () => {
  expect(bestValue(costs, 'coins')).toBe(10);
  // x5 cheaper per scan than x10 (an admin's choice): x5.
  expect(bestValue({ ...costs, coinsFive: 400 }, 'coins')).toBe(5);
  // No discount anywhere: no mark.
  expect(bestValue({ coins: 100, coinsFive: 500, coinsTen: 1000, signals: 1 }, 'coins')).toBeNull();
  // Signals cost the same per scan: no mark.
  expect(bestValue(costs, 'signal')).toBeNull();
});
