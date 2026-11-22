import { expect, test } from 'vitest';
import { cell, csvFile } from '../../src/admin/csv';

// The panel's CSV exports (the audit log, the answers of «Encuestas y avisos»): what a spreadsheet opens never runs as a
// formula, and quotes, commas and line breaks stay inside their cell.

test('una celda que empieza como una fórmula se escribe como texto', () => {
  for (const f of ['=1+1', '+34', '-2', '@SUM(A1)', '\tx', '\rx']) expect(cell(f).replace(/^"/, '').startsWith("'")).toBe(true);
  expect(cell('Hola')).toBe('Hola');
});

test('comillas, comas y saltos de línea van entre comillas', () => {
  expect(cell('a, b')).toBe('"a, b"');
  expect(cell('dijo "hola"')).toBe('"dijo ""hola"""');
  expect(cell('una\nlínea')).toBe('"una\nlínea"');
});

test('lo vacío queda vacío y lo demás va como JSON', () => {
  expect(cell(null)).toBe('');
  expect(cell(undefined)).toBe('');
  expect(cell(7)).toBe('7');
  expect(cell({ a: 1 })).toBe('"{""a"":1}"');
});

test('un archivo empieza con BOM y lleva una línea por fila', () => {
  expect(csvFile([['usuario', 'nota'], ['vega', 9]])).toBe('\uFEFFusuario,nota\nvega,9\n');
});
