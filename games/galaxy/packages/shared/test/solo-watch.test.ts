import { describe, expect, test } from 'vitest';
import { SOLO_CHUNK_MAX, soloStreamMessageSchema } from '../src/index';

// Watching a solo run live (plan «escáner pro», part G): what the player's client may send on its stream socket.

describe('el socket del directo en solitario', () => {
  test('un trozo del registro dice desde qué evento sigue, hasta qué tick llegó y cómo está la partida', () => {
    expect(soloStreamMessageSchema.parse({ t: 'f', at: 12, b: 'AAEC', to: 400, s: 'run' })).toEqual({ t: 'f', at: 12, b: 'AAEC', to: 400, s: 'run' });
    expect(soloStreamMessageSchema.parse({ t: 'f', at: 0, b: '', to: 0, s: 'pause' })).toMatchObject({ b: '' });
    expect(soloStreamMessageSchema.parse({ t: 'end' })).toEqual({ t: 'end' });
  });

  test('nada de trozos enormes, base64 raro, estados desconocidos ni campos de más', () => {
    expect(() => soloStreamMessageSchema.parse({ t: 'f', at: 0, b: 'A'.repeat(SOLO_CHUNK_MAX + 4), to: 1, s: 'run' })).toThrow();
    expect(() => soloStreamMessageSchema.parse({ t: 'f', at: 0, b: 'no es base64!', to: 1, s: 'run' })).toThrow();
    expect(() => soloStreamMessageSchema.parse({ t: 'f', at: 0, b: '', to: 1, s: 'lost' })).toThrow();
    expect(() => soloStreamMessageSchema.parse({ t: 'f', at: -1, b: '', to: 1, s: 'run' })).toThrow();
    expect(() => soloStreamMessageSchema.parse({ t: 'end', why: 'x' })).toThrow();
    expect(SOLO_CHUNK_MAX).toBeLessThanOrEqual(3400);
  });
});
