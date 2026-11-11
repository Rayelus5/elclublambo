import type { FastifyInstance } from 'fastify';

/**
 * Strict CSP of the game (GDD §18.1): everything same-origin, workers from blob:, never framed. Stripe.js is the one
 * exception (the resource shop's payment, shop and lab plan F5): its script, its frames (card fields, Apple Pay and
 * Google Pay, 3-D Secure on hooks.stripe.com), its API and its images, as Stripe's own CSP guide lists them.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://js.stripe.com https://*.js.stripe.com",
  "style-src 'self'",
  "img-src 'self' data: blob: https://*.stripe.com",
  "font-src 'self'",
  "connect-src 'self' https://api.stripe.com",
  "frame-src https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': CSP,
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  // Google Pay opens its own window from the payment form: it keeps its opener (still isolated from other sites).
  'cross-origin-opener-policy': 'same-origin-allow-popups',
};

/** Every response (API, static files, 404, errors) carries the security headers. */
export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.headers(SECURITY_HEADERS);
    return payload;
  });
}
