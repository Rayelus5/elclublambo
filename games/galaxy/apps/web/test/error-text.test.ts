import { expect, test } from 'vitest';
import { ApiError } from '../src/api/client';
import { errorText } from '../src/auth/useMe';
import { copy } from '../src/copy/es';

// A refusal that depends on the live config says the live value the server sent, never a number fixed in the copy:
// the admin can lower the trading level to 5 and the message must say 5.

test('los errores del comercio dicen el nivel y los días que pide la configuración viva', () => {
  expect(errorText(new ApiError('trade_level', 403, { minLevel: 5 }), copy.errors)).toBe('Para comerciar necesitas nivel 5');
  expect(errorText(new ApiError('trade_age', 403, { minAccountDays: 1 }), copy.errors)).toBe('Para comerciar tu cuenta necesita 1 día');
  expect(errorText(new ApiError('trade_age', 403, { minAccountDays: 2 }), copy.errors)).toBe('Para comerciar tu cuenta necesita 2 días');
});

test('una expulsión dice hasta cuándo dura', () => {
  const until = new Date(2026, 10, 12, 18, 30).toISOString();
  expect(errorText(new ApiError('clan_kicked', 409, { until }), copy.errors)).toMatch(/^Te expulsaron de ese clan hace poco\. Podrás volver a entrar a partir del .*18:30$/);
});

test('sin el dato, el mensaje no se inventa un número', () => {
  expect(errorText(new ApiError('trade_level', 403), copy.errors)).not.toMatch(/\d/);
  expect(errorText(new ApiError('trade_age', 403), copy.errors)).not.toMatch(/\d/);
  expect(errorText(new ApiError('clan_kicked', 409), copy.errors)).not.toMatch(/\d/);
});
