/** Códigos de error de la API: el cuerpo es siempre `{ "error": ApiErrorCode }`. Los textos viven en la web. */
export const API_ERROR_CODES = [
  'invalid_input',
  'username_taken',
  'username_reserved',
  'invalid_credentials',
  'rate_limited',
  'banned',
  'invalid_totp',
  'challenge_expired',
  'unauthenticated',
  'forbidden',
  'origin_rejected',
  'registration_closed',
  'maintenance',
  'invalid_reset_code',
  'config_invalid',
  'not_found',
  'internal',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
