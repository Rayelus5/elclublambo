import { expect, test } from 'vitest';
import { loginInput, passwordSchema, registerInput, resetRedeemInput, totpInput, usernameSchema } from '../src/index';

test('normaliza a minúsculas y acepta el patrón', () => {
  expect(usernameSchema.parse('SonDa_Rayo')).toBe('sonda_rayo');
  expect(usernameSchema.parse('abc')).toBe('abc');
  expect(usernameSchema.parse('a'.repeat(20))).toBe('a'.repeat(20));
});

test.each(['ab', 'a'.repeat(21), 'con espacio', 'ñandú', 'guion-medio', ' sonda', ''])('rechaza «%s»', (u) => {
  expect(usernameSchema.safeParse(u).success).toBe(false);
});

test('contraseña de 10 a 128', () => {
  expect(passwordSchema.safeParse('123456789').success).toBe(false);
  expect(passwordSchema.safeParse('1234567890').success).toBe(true);
  expect(passwordSchema.safeParse('x'.repeat(128)).success).toBe(true);
  expect(passwordSchema.safeParse('x'.repeat(129)).success).toBe(false);
});

test('registerInput rechaza contraseña igual al usuario sin distinguir mayúsculas', () => {
  expect(registerInput.safeParse({ username: 'Piloto_0123', password: 'piloto_0123' }).success).toBe(false);
  expect(registerInput.safeParse({ username: 'Piloto_0123', password: 'otra-clave-larga' }).data).toEqual({
    username: 'piloto_0123',
    password: 'otra-clave-larga',
  });
});

test('loginInput normaliza el usuario y no aplica la regla de longitud de contraseña', () => {
  // Una contraseña corta en el login es simplemente incorrecta: no debe delatar la política con otro error.
  expect(loginInput.parse({ username: 'SonDa', password: 'x' })).toEqual({ username: 'sonda', password: 'x' });
});

test('totpInput exige 6 dígitos', () => {
  expect(totpInput.safeParse({ challenge: 'x', code: '12345' }).success).toBe(false);
  expect(totpInput.safeParse({ challenge: 'x', code: '12345a' }).success).toBe(false);
  expect(totpInput.safeParse({ challenge: 'x', code: '123456' }).success).toBe(true);
});

test('resetRedeemInput valida la contraseña nueva', () => {
  expect(resetRedeemInput.safeParse({ username: 'sonda', code: 'ABCD-EFGH-JKMN-PQRS', newPassword: 'corta' }).success).toBe(false);
  expect(resetRedeemInput.safeParse({ username: 'Sonda', code: 'ABCD-EFGH-JKMN-PQRS', newPassword: 'una-clave-larga' }).data?.username).toBe('sonda');
});

test('resetRedeemInput rechaza una contraseña nueva igual al usuario (revisión final M4)', () => {
  expect(resetRedeemInput.safeParse({ username: 'Piloto_0123', code: 'ABCD-EFGH-JKMN-PQRS', newPassword: 'piloto_0123' }).success).toBe(false);
});
