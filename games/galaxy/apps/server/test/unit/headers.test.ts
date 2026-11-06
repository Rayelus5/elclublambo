import { expect, test } from 'vitest';
import { CSP, SECURITY_HEADERS } from '../../src/security/headers';

// The CSP is a security contract copied verbatim from the plan's Global Constraints (GDD §18.1).
test('CSP exacta', () => {
  expect(CSP).toBe(
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  );
});

test('cabeceras de seguridad completas', () => {
  expect(SECURITY_HEADERS).toEqual({
    'content-security-policy': CSP,
    'strict-transport-security': 'max-age=63072000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    'cross-origin-opener-policy': 'same-origin',
  });
});
