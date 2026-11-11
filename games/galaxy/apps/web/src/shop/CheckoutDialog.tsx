import type { ShopProductView, ShopPurchaseView, ShopView } from '@galaxy/shared';
import { CheckoutElementsProvider, ContactDetailsElement, ExpressCheckoutElement, PaymentElement, useCheckoutElements } from '@stripe/react-stripe-js/checkout';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useCheckout, usePurchase } from '../api/shop';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { eur } from './art-hooks';
import { amountsText, PackCanvas } from './ProductCard';
import { loadShopStripe, STRIPE_APPEARANCE } from './stripe';

// Buying a product (shop and lab plan, F5; the approved F0 mockup), in three steps in one dialog:
// 1. What it gives and its price, and the consent box (unticked): «Continuar al pago» keeps the purchase with the
//    consent on the server, which opens Stripe's payment.
// 2. Stripe's own form, loaded only now: Apple Pay or Google Pay on top, then the email for the receipt and the card.
//    The card never touches our server.
// 3. Waiting for the server to see it paid (Stripe's webhook, or the purchase asking Stripe): then the celebration.
// A payment that needs another page (3-D Secure in the bank's) comes back to the shop with the purchase in the URL,
// and this dialog opens straight on step 3.

const t = copy.shop;
const tc = copy.shop.checkout;

type Step = { kind: 'consent' } | { kind: 'pay'; purchase: string; clientSecret: string } | { kind: 'confirming'; purchase: string };

function Spinner({ label }: { label: string }) {
  return (
    <div className="shop-wait" role="status">
      <span className="shop-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

/** Stripe's form inside its provider: express wallets, the email for the receipt, the card, and «Pagar». */
function PayForm({ price, onConfirmed }: { price: string; onConfirmed: () => void }) {
  const state = useCheckoutElements();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (state.type === 'loading') return <Spinner label={tc.loading} />;
  if (state.type === 'error') return <p className="field-error" role="alert">{tc.unavailable}</p>;
  const { checkout } = state;
  const confirm = async (args: Parameters<typeof checkout.confirm>[0] = {}) => {
    setBusy(true);
    setMessage(null);
    const result = await checkout.confirm({ ...args, redirect: 'if_required' });
    setBusy(false);
    // Stripe's own message (in Spanish), or the purchase is paid: the server confirms it next.
    if (result.type === 'error') setMessage(result.error.message || tc.failed);
    else onConfirmed();
  };
  return (
    <div className="shop-pay">
      <ExpressCheckoutElement className="shop-express" onConfirm={(event) => void confirm({ expressCheckoutConfirmEvent: event })} />
      <ContactDetailsElement className="shop-contact" />
      <PaymentElement className="shop-card" options={{ wallets: { applePay: 'never', googlePay: 'never' }, layout: 'tabs' }} />
      {message ? (
        <p className="field-error" role="alert">
          {message}
        </p>
      ) : null}
      <button type="button" className="lip pill pill-solar shop-cta" disabled={busy} aria-busy={busy} onClick={() => void confirm()}>
        {busy ? tc.processing : tc.pay(price)}
      </button>
      <p className="shop-small">{tc.stripeNote}</p>
    </div>
  );
}

/** Step 3: the purchase read until it is paid; then `onPaid` (the celebration). */
function Confirming({ purchase, onPaid }: { purchase: string; onPaid: (p: ShopPurchaseView) => void }) {
  const p = usePurchase(purchase);
  const status = p.data?.status;
  const told = useRef(false);
  useEffect(() => {
    if (!p.data || status !== 'paid' || told.current) return;
    told.current = true;
    onPaid(p.data);
  }, [p.data, status, onPaid]);
  if (status === 'expired') return <p className="field-error" role="alert">{tc.expired}</p>;
  if (status === 'failed') return <p className="field-error" role="alert">{tc.failed}</p>;
  if (p.error) return <p className="field-error" role="alert">{errorText(p.error, copy.errors) ?? copy.errors.internal}</p>;
  return <Spinner label={tc.waiting} />;
}

export function CheckoutDialog({
  product,
  shop,
  reduced,
  resume = null,
  onClose,
  onPaid,
  onTerms,
}: {
  product: ShopProductView | null;
  shop: ShopView;
  reduced: boolean;
  /** A purchase back from Stripe's redirect: straight to waiting for it. */
  resume?: string | null;
  onClose: () => void;
  onPaid: (p: ShopPurchaseView) => void;
  onTerms: () => void;
}) {
  const [step, setStep] = useState<Step>(resume ? { kind: 'confirming', purchase: resume } : { kind: 'consent' });
  const [consent, setConsent] = useState(false);
  const checkout = useCheckout();
  const consentId = useId();
  const stripe = useMemo(() => (step.kind === 'pay' && shop.publishableKey ? loadShopStripe(shop.publishableKey) : null), [step.kind, shop.publishableKey]);
  const price = product ? eur(product.priceCents) : '';

  const start = () => {
    if (!product) return;
    checkout.mutate(
      { product: product.id, terms: shop.legal.termsVersion },
      { onSuccess: (c) => setStep({ kind: 'pay', purchase: c.purchase, clientSecret: c.clientSecret }) },
    );
  };

  return (
    <Dialog title={product ? product.name : tc.title} onClose={onClose} className="shop-dialog" closeOnVeil={step.kind === 'consent'}>
      {product ? (
        <div className="shop-summary">
          <PackCanvas product={product} size={40} reduced={reduced} className="shop-summary-art" />
          <div className="shop-summary-lines">
            <b>{amountsText(product.total)}</b>
            {product.offer?.kind === 'bonus' || product.first ? <span className="shop-summary-extra">{t.extraOf(amountsText(product.extra))}</span> : null}
            <span className="shop-summary-price">
              {product.beforeCents !== null ? <s>{eur(product.beforeCents)}</s> : null} {price}
            </span>
          </div>
        </div>
      ) : null}
      {step.kind === 'consent' && product ? (
        <div className="shop-step">
          <label className="shop-consent" htmlFor={consentId}>
            <input id={consentId} type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>{tc.consent}</span>
          </label>
          {checkout.error ? (
            <p className="field-error" role="alert">
              {errorText(checkout.error, copy.errors) ?? copy.errors.internal}
            </p>
          ) : null}
          <button type="button" className="lip pill pill-solar shop-cta" disabled={!consent || checkout.isPending} aria-busy={checkout.isPending} onClick={start}>
            {checkout.isPending ? tc.loading : tc.continue}
          </button>
          <p className="shop-small">
            {t.vat}{' '}
            <button type="button" className="shop-link" onClick={onTerms}>
              {t.terms}
            </button>
          </p>
        </div>
      ) : null}
      {step.kind === 'pay' && stripe ? (
        <CheckoutElementsProvider stripe={stripe} options={{ clientSecret: step.clientSecret, elementsOptions: { appearance: STRIPE_APPEARANCE } }}>
          <PayForm price={price} onConfirmed={() => setStep({ kind: 'confirming', purchase: step.purchase })} />
        </CheckoutElementsProvider>
      ) : null}
      {step.kind === 'confirming' ? <Confirming purchase={step.purchase} onPaid={onPaid} /> : null}
      <button type="button" className="lip iconbtn modal-close" aria-label={tc.close} title={tc.close} onClick={onClose}>
        <Icon name="close" />
      </button>
    </Dialog>
  );
}
