import { describe, expect, test } from 'vitest';
import { normalizeAnswers, popupAnswersSchema, type PopupQuestion, popupRecordSchema } from '../src';

// «Encuestas y avisos» (GDD §16.5): what a player's answers keep. Every answer matches its question (a score in range,
// options among its own, one when it is single), scales, stars and choices are always answered, a text only when its
// question asks for it, and texts are cleaned and pass the chat's word filter.

const questions: PopupQuestion[] = popupRecordSchema.parse({
  kind: 'form',
  title: 'Tu opinión',
  startsAt: '2026-11-23T10:00:00.000Z',
  endsAt: '2026-11-30T10:00:00.000Z',
  questions: [
    { type: 'scale', id: 'nps', prompt: '¿Nos recomendarías?', range: '0-10' },
    { type: 'scale', id: 'dif', prompt: '¿Es difícil?', range: '1-5' },
    { type: 'stars', id: 'est', prompt: '¿Qué te parece?' },
    {
      type: 'choice',
      id: 'modo',
      prompt: '¿Cómo juegas?',
      options: [
        { id: 'solo', label: 'Solo' },
        { id: 'grupo', label: 'En grupo' },
      ],
    },
    {
      type: 'choice',
      id: 'gusta',
      prompt: '¿Qué te gusta?',
      multi: true,
      options: [
        { id: 'arte', label: 'El arte' },
        { id: 'musica', label: 'La música' },
        { id: 'escaner', label: 'El escáner' },
      ],
    },
    { type: 'text', id: 'idea', prompt: '¿Alguna idea?', maxLength: 50 },
    { type: 'text', id: 'por', prompt: '¿Por qué?', required: true, maxLength: 60 },
  ],
}).questions;

const FULL = [
  { q: 'nps', score: 9 },
  { q: 'dif', score: 3 },
  { q: 'est', score: 5 },
  { q: 'modo', choices: ['grupo'] },
  { q: 'gusta', choices: ['escaner', 'arte'] },
  { q: 'idea', text: 'Más Núcleos' },
  { q: 'por', text: 'Porque me encanta' },
];
const WORDS = ['tonto'];
const codes = (raw: unknown[]) => normalizeAnswers(questions, popupAnswersSchema.parse(raw), WORDS).issues;
const without = (q: string) => FULL.filter((a) => a.q !== q);
const replace = (q: string, a: object) => FULL.map((x) => (x.q === q ? { q, ...a } : x));

describe('las respuestas de un jugador', () => {
  test('unas respuestas completas quedan en el orden de las preguntas, con las opciones en su orden', () => {
    const { answers, issues } = normalizeAnswers(questions, popupAnswersSchema.parse([...FULL].reverse()), WORDS);
    expect(issues).toEqual([]);
    expect(answers).toEqual([
      { q: 'nps', score: 9 },
      { q: 'dif', score: 3 },
      { q: 'est', score: 5 },
      { q: 'modo', choices: ['grupo'] },
      { q: 'gusta', choices: ['arte', 'escaner'] },
      { q: 'idea', text: 'Más Núcleos' },
      { q: 'por', text: 'Porque me encanta' },
    ]);
  });

  test('como mucho 10 respuestas', () => {
    expect(popupAnswersSchema.safeParse(Array.from({ length: 11 }, (_, i) => ({ q: `q${i}`, score: 1 }))).success).toBe(false);
    expect(popupAnswersSchema.safeParse([{ q: 'NPS', score: 1 }]).success).toBe(false);
  });

  test('una pregunta que no existe o repetida', () => {
    expect(codes([...FULL, { q: 'otra', score: 1 }])).toEqual([{ q: 'otra', code: 'answer_unknown' }]);
    expect(codes([...FULL, { q: 'nps', score: 1 }])).toEqual([{ q: 'nps', code: 'answer_duplicate' }]);
  });

  test('cada respuesta con la forma de su pregunta', () => {
    expect(codes(replace('nps', { choices: ['solo'] }))).toEqual([{ q: 'nps', code: 'answer_shape' }]);
    expect(codes(replace('nps', { score: 5, text: 'hola' }))).toEqual([{ q: 'nps', code: 'answer_shape' }]);
    expect(codes(replace('est', { text: 'cinco' }))).toEqual([{ q: 'est', code: 'answer_shape' }]);
    expect(codes(replace('modo', { score: 1 }))).toEqual([{ q: 'modo', code: 'answer_shape' }]);
    expect(codes(replace('idea', { score: 1 }))).toEqual([{ q: 'idea', code: 'answer_shape' }]);
    expect(codes(replace('dif', {}))).toEqual([{ q: 'dif', code: 'answer_shape' }]);
  });

  test('las notas dentro de su escala', () => {
    expect(codes(replace('nps', { score: 0 }))).toEqual([]);
    expect(codes(replace('nps', { score: 10 }))).toEqual([]);
    expect(codes(replace('nps', { score: 11 }))).toEqual([{ q: 'nps', code: 'answer_range' }]);
    expect(codes(replace('nps', { score: -1 }))).toEqual([{ q: 'nps', code: 'answer_range' }]);
    expect(codes(replace('dif', { score: 0 }))).toEqual([{ q: 'dif', code: 'answer_range' }]);
    expect(codes(replace('dif', { score: 6 }))).toEqual([{ q: 'dif', code: 'answer_range' }]);
    expect(codes(replace('est', { score: 0 }))).toEqual([{ q: 'est', code: 'answer_range' }]);
    expect(codes(replace('est', { score: 1 }))).toEqual([]);
    expect(popupAnswersSchema.safeParse([{ q: 'nps', score: 2.5 }]).success).toBe(false);
  });

  test('las opciones son de su pregunta, una sola si no es múltiple y ninguna repetida', () => {
    expect(codes(replace('modo', { choices: ['arte'] }))).toEqual([{ q: 'modo', code: 'answer_option' }]);
    expect(codes(replace('modo', { choices: ['solo', 'grupo'] }))).toEqual([{ q: 'modo', code: 'answer_single' }]);
    expect(codes(replace('gusta', { choices: ['arte', 'arte'] }))).toEqual([{ q: 'gusta', code: 'answer_option' }]);
    expect(codes(replace('gusta', { choices: ['arte', 'musica', 'escaner'] }))).toEqual([]);
  });

  test('la escala, las estrellas y la elección siempre se contestan', () => {
    expect(codes(without('nps'))).toEqual([{ q: 'nps', code: 'answer_missing' }]);
    expect(codes(without('est'))).toEqual([{ q: 'est', code: 'answer_missing' }]);
    expect(codes(without('gusta'))).toEqual([{ q: 'gusta', code: 'answer_missing' }]);
    expect(codes(replace('gusta', { choices: [] }))).toEqual([{ q: 'gusta', code: 'answer_missing' }]);
  });

  test('un texto solo si la pregunta lo pide', () => {
    expect(codes(without('idea'))).toEqual([]);
    expect(codes(without('por'))).toEqual([{ q: 'por', code: 'answer_missing' }]);
    expect(codes(replace('por', { text: '   \n  ' }))).toEqual([{ q: 'por', code: 'answer_missing' }]);
  });

  test('un texto opcional vacío no se guarda', () => {
    const { answers, issues } = normalizeAnswers(questions, popupAnswersSchema.parse(replace('idea', { text: '  ​ ' })), WORDS);
    expect(issues).toEqual([]);
    expect(answers.map((a) => a.q)).not.toContain('idea');
  });

  test('un texto no pasa de su largo', () => {
    expect(codes(replace('idea', { text: 'x'.repeat(50) }))).toEqual([]);
    expect(codes(replace('idea', { text: 'x'.repeat(51) }))).toEqual([{ q: 'idea', code: 'answer_too_long' }]);
    // Spaces are joined before measuring.
    expect(codes(replace('idea', { text: `${'x'.repeat(25)}          ${'y'.repeat(24)}` }))).toEqual([]);
  });

  test('el texto se limpia y pasa el filtro de palabras del chat', () => {
    const { answers } = normalizeAnswers(questions, popupAnswersSchema.parse(replace('por', { text: '  Es  de   TONTO\r\nno  jugarlo  ' })), WORDS);
    expect(answers.find((a) => a.q === 'por')).toEqual({ q: 'por', text: 'Es de *****\nno jugarlo' });
  });

  test('todas las faltas juntas', () => {
    const raw = [{ q: 'nps', score: 99 }, { q: 'modo', choices: ['solo', 'grupo'] }, { q: 'otra', score: 1 }];
    expect(codes(raw).map((i) => `${i.q}:${i.code}`)).toEqual([
      'nps:answer_range',
      'modo:answer_single',
      'otra:answer_unknown',
      'dif:answer_missing',
      'est:answer_missing',
      'gusta:answer_missing',
      'por:answer_missing',
    ]);
  });
});
