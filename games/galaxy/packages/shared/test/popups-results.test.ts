import { describe, expect, test } from 'vitest';
import { type PopupQuestion, summarizeQuestion } from '../src';

// «Encuestas y avisos» (GDD §16.5): what the panel shows of each question. Every value with its count (zeros too) and
// the average; a 0–10 scale's NPS (promoters 9–10 minus detractors 0–6, in points) with its three counts; a 1–5 scale's
// and the stars' share of 4 and 5; a choice's count and share of respondents for each option (a multiple choice can add
// up to more than 100 %), most picked first.

const nps: PopupQuestion = { type: 'scale', id: 'nps', prompt: '¿Nos recomendarías?', range: '0-10', low: '', high: '', subject: null };
const five: PopupQuestion = { type: 'scale', id: 'dif', prompt: '¿Es difícil?', range: '1-5', low: '', high: '', subject: null };
const stars: PopupQuestion = { type: 'stars', id: 'est', prompt: '¿Qué te parece?' };
const choice = (multi: boolean): PopupQuestion => ({
  type: 'choice',
  id: 'gusta',
  prompt: '¿Qué te gusta?',
  multi,
  options: [
    { id: 'arte', label: 'El arte' },
    { id: 'musica', label: 'La música' },
    { id: 'escaner', label: 'El escáner' },
  ],
});
const text: PopupQuestion = { type: 'text', id: 'idea', prompt: '¿Alguna idea?', placeholder: 'Escribe aquí', required: false, maxLength: 500 };

describe('el resumen de una escala de 0 a 10', () => {
  test('sin respuestas: todo a cero, sin media ni NPS', () => {
    const s = summarizeQuestion(nps, { values: {} });
    expect(s).toMatchObject({ type: 'scale', id: 'nps', range: '0-10', n: 0, average: null, nps: null, topBox: null });
    if (s.type !== 'scale') throw new Error('scale');
    expect(s.buckets.map((b) => b.value)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(s.buckets.every((b) => b.count === 0 && b.pct === 0)).toBe(true);
  });

  test('el reparto completo, con ceros, y la media', () => {
    const s = summarizeQuestion(nps, { values: { '10': 2, '7': 1, '0': 1 } });
    if (s.type !== 'scale') throw new Error('scale');
    expect(s.n).toBe(4);
    expect(s.buckets[10]).toEqual({ value: 10, count: 2, pct: 50 });
    expect(s.buckets[5]).toEqual({ value: 5, count: 0, pct: 0 });
    expect(s.average).toBe(27 / 4);
  });

  test('el NPS: promotores (9 y 10) menos detractores (0 a 6), con sus tres cuentas', () => {
    const s = summarizeQuestion(nps, { values: { '10': 3, '9': 2, '8': 2, '7': 1, '6': 1, '0': 1 } });
    if (s.type !== 'scale') throw new Error('scale');
    expect(s.nps).toEqual({ score: 30, promoters: 5, passives: 3, detractors: 2 });
    expect(s.topBox).toBeNull();
  });

  test('los extremos del NPS: todos promotores, todos detractores, todos pasivos', () => {
    const score = (values: Record<string, number>) => {
      const s = summarizeQuestion(nps, { values });
      return s.type === 'scale' ? s.nps?.score : undefined;
    };
    expect(score({ '9': 4 })).toBe(100);
    expect(score({ '6': 1, '0': 3 })).toBe(-100);
    expect(score({ '7': 2, '8': 2 })).toBe(0);
    expect(score({ '10': 1 })).toBe(100);
  });

  test('lo que no cabe en la escala no cuenta', () => {
    const s = summarizeQuestion(nps, { values: { '11': 5, '-1': 2, x: 1, '10': 1 } });
    expect(s.n).toBe(1);
  });
});

describe('el resumen de una escala de 1 a 5 y de las estrellas', () => {
  test('el porcentaje de 4 y 5, sin NPS', () => {
    const s = summarizeQuestion(five, { values: { '5': 1, '4': 2, '3': 1, '1': 4 } });
    if (s.type !== 'scale') throw new Error('scale');
    expect(s.buckets.map((b) => b.value)).toEqual([1, 2, 3, 4, 5]);
    expect(s.n).toBe(8);
    expect(s.topBox).toBe(37.5);
    expect(s.nps).toBeNull();
    expect(s.average).toBe((5 + 8 + 3 + 4) / 8);
  });

  test('las estrellas, igual', () => {
    const s = summarizeQuestion(stars, { values: { '4': 1, '5': 1 } });
    expect(s).toMatchObject({ type: 'stars', id: 'est', n: 2, topBox: 100, average: 4.5 });
    if (s.type !== 'stars') throw new Error('stars');
    expect(s.buckets.map((b) => b.count)).toEqual([0, 0, 0, 1, 1]);
    expect(summarizeQuestion(stars, { values: {} })).toMatchObject({ n: 0, topBox: null, average: null });
  });
});

describe('el resumen de una elección', () => {
  test('cada opción con su cuenta y su porcentaje, la más elegida primero y las empatadas en su orden', () => {
    const s = summarizeQuestion(choice(false), { values: { musica: 1, escaner: 3 } });
    if (s.type !== 'choice') throw new Error('choice');
    expect(s.n).toBe(4);
    expect(s.options).toEqual([
      { id: 'escaner', label: 'El escáner', count: 3, pct: 75 },
      { id: 'musica', label: 'La música', count: 1, pct: 25 },
      { id: 'arte', label: 'El arte', count: 0, pct: 0 },
    ]);
  });

  test('en una múltiple, el porcentaje es de quienes contestaron y puede sumar más de 100', () => {
    const s = summarizeQuestion(choice(true), { respondents: 4, values: { arte: 4, musica: 2, escaner: 2 } });
    if (s.type !== 'choice') throw new Error('choice');
    expect(s.multi).toBe(true);
    expect(s.n).toBe(4);
    expect(s.options.map((o) => o.pct)).toEqual([100, 50, 50]);
  });

  test('sin respuestas, todo a cero', () => {
    const s = summarizeQuestion(choice(true), { respondents: 0, values: {} });
    if (s.type !== 'choice') throw new Error('choice');
    expect(s.options.every((o) => o.count === 0 && o.pct === 0)).toBe(true);
  });

  test('una opción que no es de la pregunta no cuenta', () => {
    const s = summarizeQuestion(choice(false), { values: { arte: 1, otra: 5 } });
    expect(s.n).toBe(1);
  });
});

describe('el resumen de un texto', () => {
  test('solo cuántos contestaron (los textos se leen aparte)', () => {
    expect(summarizeQuestion(text, { respondents: 7, values: {} })).toEqual({ type: 'text', id: 'idea', n: 7 });
    expect(summarizeQuestion(text, { values: {} })).toEqual({ type: 'text', id: 'idea', n: 0 });
  });
});
