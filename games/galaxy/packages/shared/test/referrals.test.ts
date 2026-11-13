import { describe, expect, test } from 'vitest';
import { adminReferralCodeCreateSchema, parseConfig, referralCodeSchema, referralRules, registerInput } from '../src/index';

// Referrals (plan «referidos»): the codes players type, the sign-up that carries one, the rules a code follows (its
// owner's own where set, the global ones for the rest) and the live config's defaults.
describe('referidos', () => {
  test('un código se escribe como sea y se guarda en mayúsculas; de 4 a 20 letras, números o guiones', () => {
    expect(referralCodeSchema.parse(' rayelus-7k ')).toBe('RAYELUS-7K');
    expect(referralCodeSchema.parse('ABCD')).toBe('ABCD');
    for (const bad of ['abc', 'x'.repeat(21), 'con espacio', 'ñandú', 'A_B_C']) expect(referralCodeSchema.safeParse(bad).success).toBe(false);
  });

  test('el registro admite un código o ninguno', () => {
    expect(registerInput.parse({ username: 'nuevo_1', password: 'una-clave-larga' }).referralCode).toBeUndefined();
    expect(registerInput.parse({ username: 'nuevo_1', password: 'una-clave-larga', referralCode: 'vega-2024' }).referralCode).toBe('VEGA-2024');
    expect(registerInput.safeParse({ username: 'nuevo_1', password: 'una-clave-larga', referralCode: '!!' }).success).toBe(false);
  });

  test('las reglas de un código: las del dueño donde las tiene, las globales en lo demás', () => {
    const global = { ownerGifts: { coins: 100, dust: 50, signal: 2 }, newcomerGifts: { coins: 100 }, activationLevel: 5 };
    expect(referralRules(global, null)).toEqual(global);
    expect(referralRules(global, { ownerGifts: { signal: 10 }, newcomerGifts: null, activationLevel: null })).toEqual({ ownerGifts: { signal: 10 }, newcomerGifts: { coins: 100 }, activationLevel: 5 });
    expect(referralRules(global, { ownerGifts: null, newcomerGifts: { dust: 5 }, activationLevel: 8 })).toEqual({ ownerGifts: global.ownerGifts, newcomerGifts: { dust: 5 }, activationLevel: 8 });
  });

  test('la configuración viva: sin código obligatorio, 100 de oro, 50 de polvo y 2 señales, el dueño cobra al nivel 5', () => {
    const c = parseConfig('referrals', {});
    expect(c.required).toBe(false);
    expect(c.ownerGifts).toEqual({ coins: 100, dust: 50, signal: 2 });
    expect(c.newcomerGifts).toEqual({ coins: 100, dust: 50, signal: 2 });
    expect(c.activationLevel).toBe(5);
    expect(() => parseConfig('referrals', { ownerGifts: { signal: 101 } })).toThrow();
    expect(() => parseConfig('referrals', { activationLevel: 0 })).toThrow();
  });

  test('crear un código pide dueño y motivo; el código propio es opcional', () => {
    expect(adminReferralCodeCreateSchema.parse({ owner: 'Vega', reason: 'Veterana' })).toMatchObject({ owner: 'vega' });
    expect(adminReferralCodeCreateSchema.parse({ owner: 'vega', code: 'vega-amigos', maxUses: 50, reason: 'Veterana' })).toMatchObject({ code: 'VEGA-AMIGOS', maxUses: 50 });
    expect(adminReferralCodeCreateSchema.safeParse({ owner: 'vega' }).success).toBe(false);
  });
});
