import { expect, test } from 'vitest';
import { checkoutReturnOrigin } from '../../src/shop/service';

// Stripe's return URL (galaxysurvivor.es plan, PR 1): each payment comes back to the host where it started. Only one of
// our own origins is ever used; without one, the canonical origin, and then the first configured one.

const origins = ['https://pre.elclub.party', 'http://localhost:5173', 'https://galaxysurvivor.es'];

test('vuelve al origen de la petición cuando es uno de los nuestros', () => {
  expect(checkoutReturnOrigin('https://galaxysurvivor.es', { origins, canonicalOrigin: 'https://galaxysurvivor.es' })).toBe('https://galaxysurvivor.es');
  expect(checkoutReturnOrigin('https://pre.elclub.party', { origins, canonicalOrigin: 'https://galaxysurvivor.es' })).toBe('https://pre.elclub.party');
});

test.each([undefined, '', 'null', 'https://evil.com', 'https://pre.elclub.party/', 'https://galaxysurvivor.es.evil.com'])(
  'sin un origen nuestro en la petición (%s), el canónico; y sin canónico, el primero',
  (origin) => {
    expect(checkoutReturnOrigin(origin, { origins, canonicalOrigin: 'https://galaxysurvivor.es' })).toBe('https://galaxysurvivor.es');
    expect(checkoutReturnOrigin(origin, { origins, canonicalOrigin: null })).toBe('https://pre.elclub.party');
    expect(checkoutReturnOrigin(origin, { origins })).toBe('https://pre.elclub.party');
  },
);
