import { describe, expect, test } from 'vitest';
import {
  type Gift,
  parseConfig,
  POPUP_ISSUE_CODES,
  popupBigReasons,
  popupIssues,
  popupRecordSchema,
  popupState,
} from '../src';

// «Encuestas y avisos» (GDD §16.5): the record an admin saves for a popup shown when a player opens the game. Each kind
// has its shape (a survey, one scale; a review, stars and maybe a text; a form, 1 to 10 of anything; a promotion, none
// and never a reward), its ids are unique, it lasts 90 days at most, and a few problems only stop publishing it.

const coins = (amount: number): Gift => ({ kind: 'currency', currency: 'coins', amount });
const IMAGE = '0b7f6a2e-3c1d-4e5f-9a8b-7c6d5e4f3a2b';
const DATES = { startsAt: '2026-11-23T10:00:00.000Z', endsAt: '2026-11-30T10:00:00.000Z' };
const scale = (id = 'q1', extra = {}) => ({ type: 'scale', id, prompt: '¿Recomendarías Galaxy Survivor?', range: '0-10', ...extra });
const stars = (id = 'q1') => ({ type: 'stars', id, prompt: '¿Qué te parece el juego?' });
const text = (id = 'q2', extra = {}) => ({ type: 'text', id, prompt: 'Cuéntanos más', ...extra });
const choice = (id = 'q3', extra = {}) => ({
  type: 'choice',
  id,
  prompt: '¿Qué modo juegas más?',
  options: [
    { id: 'solo', label: 'Solo' },
    { id: 'grupo', label: 'En grupo' },
  ],
  ...extra,
});
const SURVEY = { kind: 'survey', title: '¿Nos recomiendas?', questions: [scale()], ...DATES };
const PROMO = { kind: 'promotion', title: 'Temporada 2', body: 'Ya está aquí', imageMedia: IMAGE, ...DATES };
const NOW = new Date('2026-11-22T12:00:00.000Z');
const messages = (input: unknown, ctx: Parameters<typeof popupIssues>[1] = {}) => popupIssues(input, ctx).map((i) => i.message);

describe('la ficha de una campaña', () => {
  test('una encuesta mínima se completa con los valores por defecto', () => {
    const p = popupRecordSchema.parse(SURVEY);
    expect(p).toMatchObject({ body: '', imageMedia: null, link: null, audience: { kind: 'all' }, priority: 1, reward: [] });
    expect(p.questions[0]).toEqual({ type: 'scale', id: 'q1', prompt: '¿Recomendarías Galaxy Survivor?', range: '0-10', low: '', high: '', subject: null });
  });

  test('una pregunta de texto tiene marcador, no es obligatoria y admite 500 caracteres si no se dice otra cosa', () => {
    const p = popupRecordSchema.parse({ kind: 'review', title: 'Valóranos', questions: [stars(), text()], ...DATES });
    expect(p.questions[1]).toEqual({ type: 'text', id: 'q2', prompt: 'Cuéntanos más', placeholder: 'Escribe aquí', required: false, maxLength: 500 });
    expect(messages({ ...SURVEY, kind: 'form', questions: [text('q2', { maxLength: 49 })] }).length).toBeGreaterThan(0);
    expect(messages({ ...SURVEY, kind: 'form', questions: [text('q2', { maxLength: 1001 })] }).length).toBeGreaterThan(0);
    expect(messages({ ...SURVEY, kind: 'form', questions: [text('q2', { maxLength: 50, required: true })] })).toEqual([]);
  });

  test('los textos tienen su largo máximo', () => {
    expect(messages({ ...SURVEY, title: '' }).length).toBeGreaterThan(0);
    expect(messages({ ...SURVEY, title: 'x'.repeat(81) }).length).toBeGreaterThan(0);
    expect(messages({ ...SURVEY, body: 'x'.repeat(1201) }).length).toBeGreaterThan(0);
    expect(messages({ ...SURVEY, questions: [scale('q1', { prompt: 'x'.repeat(121) })] }).length).toBeGreaterThan(0);
    expect(messages({ ...SURVEY, questions: [scale('q1', { low: 'x'.repeat(31) })] }).length).toBeGreaterThan(0);
    expect(messages({ ...SURVEY, questions: [scale('q1', { low: 'Nada probable', high: 'Muy probable' })] })).toEqual([]);
  });

  test('una encuesta lleva exactamente una pregunta de escala', () => {
    expect(messages(SURVEY)).toEqual([]);
    expect(messages({ ...SURVEY, questions: [] })).toContain('popup_survey_shape');
    expect(messages({ ...SURVEY, questions: [scale('q1'), scale('q2')] })).toContain('popup_survey_shape');
    expect(messages({ ...SURVEY, questions: [stars()] })).toContain('popup_survey_shape');
    expect(messages({ ...SURVEY, questions: [scale('q1', { range: '1-5' })] })).toEqual([]);
    expect(messages({ ...SURVEY, questions: [scale('q1', { range: '1-10' })] }).length).toBeGreaterThan(0);
  });

  test('el tema de una escala es un enemigo, un Núcleo, una sonda o un sector', () => {
    expect(messages({ ...SURVEY, questions: [scale('q1', { subject: { kind: 'enemy', id: 'spitter' } })] })).toEqual([]);
    expect(messages({ ...SURVEY, questions: [scale('q1', { subject: { kind: 'boss', id: 'hive-core' } })] })).toEqual([]);
    expect(messages({ ...SURVEY, questions: [scale('q1', { subject: { kind: 'galaxy', id: 'x' } })] }).length).toBeGreaterThan(0);
    const ctx = { subjects: { enemy: ['spitter'], boss: [], probe: [], sector: [] } };
    expect(messages({ ...SURVEY, questions: [scale('q1', { subject: { kind: 'enemy', id: 'spitter' } })] }, ctx)).toEqual([]);
    expect(messages({ ...SURVEY, questions: [scale('q1', { subject: { kind: 'enemy', id: 'ghost' } })] }, ctx)).toContain('popup_subject_unknown');
  });

  test('una valoración son estrellas y, si acaso, un texto detrás', () => {
    const review = { kind: 'review', title: 'Valóranos', ...DATES };
    expect(messages({ ...review, questions: [stars()] })).toEqual([]);
    expect(messages({ ...review, questions: [stars(), text()] })).toEqual([]);
    expect(messages({ ...review, questions: [] })).toContain('popup_review_shape');
    expect(messages({ ...review, questions: [text('q2'), stars('q1')] })).toContain('popup_review_shape');
    expect(messages({ ...review, questions: [stars(), choice()] })).toContain('popup_review_shape');
    expect(messages({ ...review, questions: [stars(), text('q2'), text('q3')] })).toContain('popup_review_shape');
  });

  test('un formulario lleva de 1 a 10 preguntas de cualquier tipo', () => {
    const form = { kind: 'form', title: 'Tu opinión', ...DATES };
    expect(messages({ ...form, questions: [scale('a'), stars('b'), choice('c', { multi: true }), text('d', { required: true })] })).toEqual([]);
    expect(messages({ ...form, questions: [] })).toContain('popup_form_empty');
    const ten = Array.from({ length: 10 }, (_, i) => stars(`q${i}`));
    expect(messages({ ...form, questions: ten })).toEqual([]);
    expect(messages({ ...form, questions: [...ten, stars('q10')] }).length).toBeGreaterThan(0);
  });

  test('una pregunta de elección tiene de 2 a 8 opciones', () => {
    const form = { kind: 'form', title: 'Tu opinión', ...DATES };
    const options = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `o${i}`, label: `Opción ${i}` }));
    expect(popupRecordSchema.parse({ ...form, questions: [choice()] }).questions[0]).toMatchObject({ multi: false });
    expect(messages({ ...form, questions: [choice('c', { options: options(1) })] }).length).toBeGreaterThan(0);
    expect(messages({ ...form, questions: [choice('c', { options: options(8) })] })).toEqual([]);
    expect(messages({ ...form, questions: [choice('c', { options: options(9) })] }).length).toBeGreaterThan(0);
    expect(messages({ ...form, questions: [choice('c', { options: [{ id: 'a', label: 'x'.repeat(61) }, { id: 'b', label: 'B' }] })] }).length).toBeGreaterThan(0);
  });

  test('los ids de preguntas y opciones son cortos, en minúsculas y no se repiten', () => {
    const form = { kind: 'form', title: 'Tu opinión', ...DATES };
    expect(messages({ ...form, questions: [stars('Q1')] }).length).toBeGreaterThan(0);
    expect(messages({ ...form, questions: [stars('pregunta-uno')] }).length).toBeGreaterThan(0);
    expect(messages({ ...form, questions: [stars('abcdefghijkl')] })).toEqual([]);
    expect(messages({ ...form, questions: [stars('abcdefghijklm')] }).length).toBeGreaterThan(0);
    expect(messages({ ...form, questions: [stars('a'), text('a')] })).toContain('popup_question_duplicate');
    const twice = [
      { id: 'si', label: 'Sí' },
      { id: 'si', label: 'Claro' },
    ];
    expect(messages({ ...form, questions: [choice('c', { options: twice })] })).toContain('popup_option_duplicate');
  });

  test('una promoción no lleva preguntas ni premio, y su enlace es opcional', () => {
    expect(messages(PROMO)).toEqual([]);
    expect(messages({ ...PROMO, link: { kind: 'route', to: '/temporada', label: 'Ver la temporada' } })).toEqual([]);
    expect(messages({ ...PROMO, link: { kind: 'url', href: 'https://discord.gg/galaxy', label: 'Discord' } })).toEqual([]);
    expect(messages({ ...PROMO, link: { kind: 'url', href: 'http://inseguro.es', label: 'Web' } }).length).toBeGreaterThan(0);
    expect(messages({ ...PROMO, questions: [stars()] })).toContain('popup_promotion_questions');
    expect(messages({ ...PROMO, reward: [coins(100)] })).toContain('popup_promotion_reward');
  });

  test('solo una promoción lleva el botón «Ver más»', () => {
    expect(messages({ ...SURVEY, link: { kind: 'route', to: '/temporada', label: 'Ver' } })).toContain('popup_link_kind');
  });

  test('las encuestas, valoraciones y formularios pueden dar premio, de 20 regalos como mucho', () => {
    expect(messages({ ...SURVEY, reward: [coins(500)] })).toEqual([]);
    expect(messages({ ...SURVEY, reward: Array.from({ length: 21 }, () => coins(1)) }).length).toBeGreaterThan(0);
  });

  test('el premio no acaba con la temporada ni con un evento', () => {
    expect(messages({ ...SURVEY, reward: [{ kind: 'seasonPoints', amount: 50 }] })).toContain('popup_gift_seasonal');
    expect(messages({ ...SURVEY, reward: [{ kind: 'currency', currency: 'season:season-2', amount: 50 }] })).toContain('popup_gift_seasonal');
    expect(messages({ ...SURVEY, reward: [{ kind: 'currency', currency: 'signal:halloween', amount: 5 }] })).toContain('popup_gift_event');
  });

  test('con lo que hay en vivo, cada regalo se comprueba como en el buzón', () => {
    const live = { cosmetics: parseConfig('cosmetics', {}), probes: ['scout'], events: [], season: { id: 'season-2', open: false }, now: NOW };
    expect(messages({ ...SURVEY, reward: [{ kind: 'probe', probe: 'scout' }] }, { gifts: live })).toEqual([]);
    expect(messages({ ...SURVEY, reward: [{ kind: 'probe', probe: 'ghost' }] }, { gifts: live })).toContain('gift_probe_unknown');
  });

  test('la prioridad es baja, normal o alta', () => {
    expect(messages({ ...SURVEY, priority: 0 })).toEqual([]);
    expect(messages({ ...SURVEY, priority: 2 })).toEqual([]);
    expect(messages({ ...SURVEY, priority: 3 }).length).toBeGreaterThan(0);
  });

  test('el público es el del buzón', () => {
    expect(messages({ ...SURVEY, audience: { kind: 'segment', usernames: ['vega'] } })).toEqual([]);
    expect(messages({ ...SURVEY, audience: { kind: 'segment' } }).length).toBeGreaterThan(0);
  });

  test('acaba después de empezar y dura 90 días como mucho', () => {
    expect(messages({ ...SURVEY, endsAt: SURVEY.startsAt })).toContain('popup_dates');
    expect(messages({ ...SURVEY, startsAt: '2026-11-23T10:00:00.000Z', endsAt: '2027-02-21T10:00:00.000Z' })).toEqual([]);
    expect(messages({ ...SURVEY, startsAt: '2026-11-23T10:00:00.000Z', endsAt: '2027-02-21T10:00:00.001Z' })).toContain('popup_too_long');
  });

  test('un borrador se guarda aunque falte la imagen o ya haya acabado, pero no se publica así', () => {
    const draft = { ...PROMO, imageMedia: null, startsAt: '2026-11-01T10:00:00.000Z', endsAt: '2026-11-02T10:00:00.000Z' };
    expect(messages(draft)).toEqual([]);
    expect(messages(draft, { now: NOW })).toEqual([]);
    expect(messages(draft, { forPublish: true, now: NOW }).sort()).toEqual(['popup_end_past', 'popup_image_missing']);
    expect(messages(PROMO, { forPublish: true, now: NOW })).toEqual([]);
    // Only a promotion needs its image.
    expect(messages(SURVEY, { forPublish: true, now: NOW })).toEqual([]);
  });

  test('la imagen tiene que estar subida', () => {
    expect(messages(PROMO, { media: [IMAGE] })).toEqual([]);
    expect(messages(PROMO, { media: [] })).toContain('popup_media_unknown');
  });

  test('cada aviso tiene su código', () => {
    const all = [
      ...messages({ ...SURVEY, questions: [] }),
      ...messages({ ...PROMO, imageMedia: null, endsAt: '2026-11-22T11:00:00.000Z', startsAt: '2026-11-22T10:00:00.000Z' }, { forPublish: true, now: NOW }),
    ];
    for (const m of all) expect(POPUP_ISSUE_CODES as readonly string[]).toContain(m);
  });
});

describe('el estado de una campaña', () => {
  const row = { state: 'published' as const, startsAt: DATES.startsAt, endsAt: DATES.endsAt, endedAt: null };
  test('un borrador es un borrador aunque estén sus fechas', () => {
    expect(popupState({ ...row, state: 'draft' }, new Date('2026-11-25T00:00:00.000Z'))).toBe('draft');
  });
  test('publicada: programada, en curso y terminada', () => {
    expect(popupState(row, new Date('2026-11-23T09:59:59.999Z'))).toBe('scheduled');
    expect(popupState(row, new Date(DATES.startsAt))).toBe('live');
    expect(popupState(row, new Date('2026-11-30T09:59:59.999Z'))).toBe('live');
    expect(popupState(row, new Date(DATES.endsAt))).toBe('ended');
  });
  test('terminada antes de tiempo por un admin', () => {
    expect(popupState({ ...row, endedAt: '2026-11-25T00:00:00.000Z' }, new Date('2026-11-26T00:00:00.000Z'))).toBe('ended');
  });
});

describe('quién publica un premio grande', () => {
  const limits = parseConfig('mailLimits', {});
  const cosmetics = parseConfig('cosmetics', {});
  const record = (extra = {}) => popupRecordSchema.parse({ ...SURVEY, ...extra });

  test('sin premio o con un premio pequeño, cualquier admin', () => {
    expect(popupBigReasons(record(), limits, cosmetics)).toEqual([]);
    expect(popupBigReasons(record({ reward: [coins(100)] }), limits, cosmetics)).toEqual([]);
  });

  test('por encima de los límites del buzón, un superadmin', () => {
    expect(popupBigReasons(record({ reward: [coins(limits.currency.coins + 1)] }), limits, cosmetics)).toEqual(['currency_coins']);
  });

  test('el límite de destinatarios cuenta la lista de nombres o, para todos y los segmentos, a cualquiera', () => {
    const few = { ...limits, recipients: 2 };
    expect(popupBigReasons(record({ reward: [coins(1)], audience: { kind: 'segment', usernames: ['vega', 'nova'] } }), few, cosmetics)).toEqual([]);
    expect(popupBigReasons(record({ reward: [coins(1)], audience: { kind: 'segment', usernames: ['vega', 'nova', 'orion'] } }), few, cosmetics)).toEqual(['recipients']);
    expect(popupBigReasons(record({ reward: [coins(1)] }), few, cosmetics)).toEqual(['recipients']);
    expect(popupBigReasons(record({ reward: [coins(1)], audience: { kind: 'segment', minLevel: 5 } }), few, cosmetics)).toEqual(['recipients']);
    expect(popupBigReasons(record({ reward: [coins(1)] }), few, cosmetics, 2)).toEqual([]);
  });
});
