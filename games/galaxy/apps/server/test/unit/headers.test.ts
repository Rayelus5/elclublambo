import { expect, test } from 'vitest';
import { CSP, SECURITY_HEADERS } from '../../src/security/headers';

// The CSP is a security contract copied verbatim from the plan's Global Constraints (GDD §18.1): same-origin, but for
// Stripe.js (the shop's payment, as Stripe's CSP guide lists it).
test('CSP exacta', () => {
  expect(CSP).toBe(
    "default-src 'self'; script-src 'self' https://js.stripe.com https://*.js.stripe.com; style-src 'self'; img-src 'self' data: blob: https://*.stripe.com; font-src 'self'; connect-src 'self' https://api.stripe.com; frame-src https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  );
});

test('cabeceras de seguridad completas', () => {
  expect(SECURITY_HEADERS).toEqual({
    'content-security-policy': CSP,
    'strict-transport-security': 'max-age=63072000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    'cross-origin-opener-policy': 'same-origin-allow-popups',
  });
});
