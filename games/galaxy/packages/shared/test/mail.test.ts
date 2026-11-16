import { describe, expect, test } from 'vitest';
import { API_ERROR_CODES, adminMailPreviewSchema, adminMailSendSchema, adminNoticeSchema, expiringSoon, inAudience, MAIL_TYPES, mailGiftsSchema, parseConfig } from '../src/index';

// Communication (GDD §16.5; M6d-1): what an admin sends (news for everyone or for a segment, with gifts) and the
// notices of the title screen; who a message reaches: accounts that existed when it was sent and match its segment.

const sentAt = new Date('2026-11-08T12:00:00.000Z');
const vega = { level: 12, createdAt: new Date('2026-11-01T10:00:00.000Z'), username: 'vega' };

describe('regalos', () => {
  test('monedas, polvo y señales, cada uno en su tope; vacío es sin regalo', () => {
    expect(mailGiftsSchema.parse({})).toEqual({});
    expect(mailGiftsSchema.parse({ coins: 500, dust: 20, signal: 1 })).toEqual({ coins: 500, dust: 20, signal: 1 });
    expect(() => mailGiftsSchema.parse({ coins: 100_001 })).toThrow();
    expect(() => mailGiftsSchema.parse({ signal: 101 })).toThrow();
    expect(() => mailGiftsSchema.parse({ coins: -1 })).toThrow();
    expect(() => mailGiftsSchema.parse({ gems: 5 })).toThrow();
  });
});

describe('enviar', () => {
  test('título, texto, regalos, audiencia y caducidad de 1 a 365 días (30 por defecto), con motivo', () => {
    const m = adminMailSendSchema.parse({ title: 'Bienvenida a la beta', body: 'Gracias por probar el juego', gifts: { coins: 100 }, audience: { kind: 'all' }, reason: 'Inicio de la beta', password: 'x' });
    // Mail v2 (2026-11-16): the old gifts arrive as the new kind, and a message is an announcement unless it says.
    expect(m).toMatchObject({ expiresInDays: 30, audience: { kind: 'all' }, type: 'announcement', gifts: { items: [{ kind: 'currency', currency: 'coins', amount: 100 }], packs: [] } });
    expect(() => adminMailSendSchema.parse({ ...m, title: '' })).toThrow();
    expect(() => adminMailSendSchema.parse({ ...m, body: 'x'.repeat(2001) })).toThrow();
    expect(() => adminMailSendSchema.parse({ ...m, expiresInDays: 366 })).toThrow();
  });

  test('un segmento pide al menos una condición, niveles en orden y hasta 200 nombres', () => {
    expect(adminMailPreviewSchema.parse({ audience: { kind: 'segment', minLevel: 5 } })).toEqual({ audience: { kind: 'segment', minLevel: 5 } });
    expect(adminMailPreviewSchema.parse({ audience: { kind: 'segment', usernames: ['Vega', 'nova'] } }).audience).toEqual({ kind: 'segment', usernames: ['vega', 'nova'] });
    expect(() => adminMailPreviewSchema.parse({ audience: { kind: 'segment' } })).toThrow();
    expect(() => adminMailPreviewSchema.parse({ audience: { kind: 'segment', minLevel: 10, maxLevel: 5 } })).toThrow();
    expect(() => adminMailPreviewSchema.parse({ audience: { kind: 'segment', usernames: Array.from({ length: 201 }, (_, i) => `p${i}x`) } })).toThrow();
  });
});

describe('a quién llega', () => {
  test('a todas las cuentas que ya existían al enviarse', () => {
    expect(inAudience({ kind: 'all' }, vega, sentAt)).toBe(true);
    expect(inAudience({ kind: 'all' }, { ...vega, createdAt: new Date('2026-11-09T00:00:00.000Z') }, sentAt)).toBe(false);
  });

  test('un segmento: nivel, fecha de alta (los dos extremos incluidos) y nombres', () => {
    expect(inAudience({ kind: 'segment', minLevel: 10, maxLevel: 12 }, vega, sentAt)).toBe(true);
    expect(inAudience({ kind: 'segment', minLevel: 13 }, vega, sentAt)).toBe(false);
    expect(inAudience({ kind: 'segment', joinedFrom: '2026-11-01', joinedTo: '2026-11-01' }, vega, sentAt)).toBe(true);
    expect(inAudience({ kind: 'segment', joinedFrom: '2026-11-02' }, vega, sentAt)).toBe(false);
    expect(inAudience({ kind: 'segment', usernames: ['nova', 'vega'] }, vega, sentAt)).toBe(true);
    expect(inAudience({ kind: 'segment', usernames: ['nova'], minLevel: 1 }, vega, sentAt)).toBe(false);
  });
});

test('un aviso tiene texto de hasta 200 caracteres, tono y fechas en orden', () => {
  const n = adminNoticeSchema.parse({ text: 'Mantenimiento el domingo a las 10', tone: 'warning', startsAt: '2026-11-08T10:00:00.000Z', endsAt: '2026-11-09T10:00:00.000Z', reason: 'Aviso de mantenimiento' });
  expect(n.tone).toBe('warning');
  expect(() => adminNoticeSchema.parse({ ...n, endsAt: '2026-11-08T09:00:00.000Z' })).toThrow();
  expect(() => adminNoticeSchema.parse({ ...n, text: 'x'.repeat(201) })).toThrow();
  expect(() => adminNoticeSchema.parse({ ...n, tone: 'alarm' })).toThrow();
});

test('los errores nuevos del buzón existen', () => {
  for (const code of ['mail_claimed', 'mail_gone'] as const) expect(API_ERROR_CODES).toContain(code);
});

describe('correo v2: tipos y regalos de todo tipo', () => {
  const base = { title: 'Un regalo', body: 'Para ti', audience: { kind: 'all' as const }, reason: 'Una prueba', password: 'x' };

  test('un mensaje tiene su tipo, y los automáticos del juego no los envía un admin', () => {
    expect(MAIL_TYPES).toEqual(['announcement', 'gift', 'compensation', 'event', 'reward', 'personal']);
    expect(adminMailSendSchema.parse({ ...base, type: 'compensation' }).type).toBe('compensation');
    expect(() => adminMailSendSchema.parse({ ...base, type: 'referral' })).toThrow();
  });

  test('lleva regalos sueltos de cualquier tipo y packs de la biblioteca', () => {
    const m = adminMailSendSchema.parse({
      ...base,
      type: 'gift',
      gifts: { items: [{ kind: 'cosmetic', piece: 'frame', id: 'gold' }, { kind: 'currency', currency: 'components', amount: 20 }], packs: ['bienvenida'] },
    });
    expect(m.gifts.items).toHaveLength(2);
    expect(m.gifts.packs).toEqual(['bienvenida']);
  });

  test('un aviso de caducidad sale los últimos días', () => {
    const now = new Date('2026-11-16T12:00:00.000Z');
    expect(expiringSoon('2026-11-18T12:00:00.000Z', now, 3)).toBe(true);
    expect(expiringSoon('2026-11-25T12:00:00.000Z', now, 3)).toBe(false);
  });

  test('el buzón y la biblioteca de packs tienen su configuración, y sus límites también', () => {
    const mail = parseConfig('mail', {});
    expect(mail.packs).toEqual([]);
    expect(mail.warnDays).toBeGreaterThan(0);
    expect(() => parseConfig('mail', { packs: [{ id: 'x', name: 'X', art: 'parcel', items: [], enabled: true }, { id: 'x', name: 'Y', art: 'chest', items: [], enabled: true }] })).toThrow();
    expect(parseConfig('mailLimits', {}).galaxyTier).toBe('legendary');
  });
});
