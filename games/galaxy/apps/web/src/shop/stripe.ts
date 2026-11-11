import type { Appearance, Stripe } from '@stripe/stripe-js';

// Stripe.js for the shop's payment (shop and lab plan, F5), loaded only when a payment opens: the `pure` entry never
// injects Stripe's script on import, so nothing of Stripe reaches a page that does not pay (the CSP lists its hosts
// for this alone). Once loaded it is kept for the session. Tests replace `loadShopStripe` through the module.

let loading: Promise<Stripe | null> | null = null;
let loadedKey: string | null = null;

/** Stripe.js with the shop's publishable key (from the shop's view: never in the build). */
export function loadShopStripe(publishableKey: string): Promise<Stripe | null> {
  if (loading && loadedKey === publishableKey) return loading;
  loadedKey = publishableKey;
  loading = import('@stripe/stripe-js/pure').then(({ loadStripe }) => loadStripe(publishableKey, { locale: 'es' }));
  return loading;
}

/** Stripe's form in the game's colours (its «night» theme, our fonts are not loaded into its frames). */
export const STRIPE_APPEARANCE: Appearance = {
  theme: 'night',
  variables: {
    colorPrimary: '#ffc94a',
    colorBackground: '#0f1130',
    colorText: '#f3f5ff',
    colorTextSecondary: '#b9bfe6',
    colorDanger: '#ff6b7a',
    borderRadius: '10px',
    fontSizeBase: '16px',
    spacingUnit: '4px',
  },
  rules: {
    '.Input': { border: '1px solid #30345f', boxShadow: 'none' },
    '.Input:focus': { border: '1px solid #4767f2', boxShadow: '0 0 0 2px #4767f2' },
    '.Tab': { border: '1px solid #30345f' },
    '.Tab--selected': { border: '1px solid #ffc94a' },
  },
};
