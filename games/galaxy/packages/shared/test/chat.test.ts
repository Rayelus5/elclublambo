import { describe, expect, test } from 'vitest';
import { API_ERROR_CODES, chatMuteSchema, chatReportSchema, chatSendSchema, cleanBody, maskWords, parseConfig } from '../src/index';

// The chats (GDD §14.4; M5b-2): what is written is cleaned (spaces, control characters, length) and the words of the
// live filter are covered with asterisks, whole words only, whatever the case or the accents.

describe('el filtro de palabras', () => {
  const words = ['tonto', 'feo'];

  test('tapa la palabra entera, sin distinguir mayúsculas ni tildes, y conserva la longitud', () => {
    expect(maskWords('Eres TONTO', words)).toBe('Eres *****');
    expect(maskWords('qué tontó', words)).toBe('qué *****');
    expect(maskWords('tonto, muy feo.', words)).toBe('*****, muy ***.');
  });

  test('no toca una palabra que solo la contiene', () => {
    expect(maskWords('tontolaba y feote', words)).toBe('tontolaba y feote');
    expect(maskWords('hola', [])).toBe('hola');
  });
});

describe('limpiar lo escrito', () => {
  test('junta espacios, quita los caracteres de control y deja como mucho una línea en blanco', () => {
    expect(cleanBody('  hola   mundo  ', 280)).toBe('hola mundo');
    expect(cleanBody('a\u0007b​c', 280)).toBe('abc');
    expect(cleanBody('línea\r\n\n\n\notra', 280)).toBe('línea\n\notra');
  });

  test('vacío o demasiado largo no vale', () => {
    expect(cleanBody('', 280)).toBeNull();
    expect(cleanBody('   \n  ', 280)).toBeNull();
    expect(cleanBody('ñ'.repeat(281), 280)).toBeNull();
    expect(cleanBody('ñ'.repeat(280), 280)).toBe('ñ'.repeat(280));
  });
});

describe('la configuración y la API', () => {
  test('nivel 5, seis por minuto, 280 caracteres, 50 de historial, tres denuncias y sin palabras', () => {
    expect(parseConfig('chat', {})).toEqual({ minLevel: 5, perMinute: 6, maxLength: 280, history: 50, hideAfter: 3, words: [] });
    expect(() => parseConfig('chat', { words: Array.from({ length: 501 }, (_, i) => `palabra${i}`) })).toThrow();
    expect(() => parseConfig('chat', { words: ['a'] })).toThrow();
  });

  test('los esquemas', () => {
    expect(chatSendSchema.safeParse({ body: 'hola' }).success).toBe(true);
    expect(chatSendSchema.safeParse({ body: 'x'.repeat(2001) }).success).toBe(false);
    expect(chatReportSchema.parse({})).toEqual({});
    expect(chatMuteSchema.safeParse({ username: 'vega', minutes: 60, reason: 'Insultos' }).success).toBe(true);
    expect(chatMuteSchema.safeParse({ username: 'vega', minutes: 0, reason: 'x' }).success).toBe(false);
    expect(chatMuteSchema.safeParse({ username: 'vega', minutes: 60, reason: '' }).success).toBe(false);
  });

  test('los errores nuevos existen', () => {
    for (const code of ['chat_level', 'chat_muted', 'chat_empty', 'message_not_found']) expect(API_ERROR_CODES, code).toContain(code);
  });
});

describe('lo que se conserva y lo que no', () => {
  test('los emojis compuestos y el ZWNJ de otras escrituras siguen enteros', () => {
    const emoji = '\u{1F9D1}\u200D\u{1F680} \u{1F3F3}\uFE0F\u200D\u{1F308} \u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}';
    expect(cleanBody(emoji, 280)).toBe(emoji);
    expect(cleanBody('\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645', 280)).toBe('\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645');
  });

  test('los controles de dirección y los espacios invisibles se van', () => {
    expect(cleanBody('a\u202Eb\u200Bc\uFEFFd\u2066e\u2060f', 280)).toBe('abcdef');
  });

  test('una torre de marcas (zalgo) se queda en cuatro, y lo escrito se compone', () => {
    expect(cleanBody(`a${'\u0301'.repeat(50)}`, 280)).toBe(`\u00E1${'\u0301'.repeat(4)}`);
    expect(cleanBody('to\u0301nto', 280)).toBe('t\u00F3nto');
  });
});
