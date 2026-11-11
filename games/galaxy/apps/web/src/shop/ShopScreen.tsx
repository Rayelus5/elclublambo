import type { ShopProductView, ShopPurchaseView, ShopView } from '@galaxy/shared';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useShop } from '../api/shop';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { WalletBar } from '../hub/WalletBar';
import { BackLink } from '../ui/BackLink';
import { Dialog } from '../ui/Dialog';
import { Icon, type IconName } from '../ui/Icon';
import { useReducedMotion } from '../ui/motion';
import { eur } from './art-hooks';
import { CheckoutDialog } from './CheckoutDialog';
import { amountsText, blockText, PackCanvas, ProductCard } from './ProductCard';
import { usePurchaseFx } from './PurchaseFx';

// The resource shop (shop and lab plan, F5; the approved F0 mockup): the featured offer with its real countdown, the
// welcome pack and the first purchase's extra, then a tab per currency and one for packs, six products each in a grid
// that never grows sideways. Limits and the purchase terms are behind a button. Buying opens the payment dialog, and a
// delivered purchase is celebrated. Every number comes from the server; closed or blocked, it says so.

const t = copy.shop;
type Tab = ShopProductView['tab'];
const TABS: { tab: Tab; slug: string; icon: IconName }[] = [
  { tab: 'coins', slug: 'monedas', icon: 'coin' },
  { tab: 'dust', slug: 'polvo', icon: 'dust' },
  { tab: 'components', slug: 'componentes', icon: 'wrench' },
  { tab: 'packs', slug: 'packs', icon: 'star' },
];

/** The time left until `endsAt`, ticking each second while it is on screen. */
function Countdown({ endsAt }: { endsAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, Math.floor((Date.parse(endsAt) - now) / 1000));
  const text = t.left(Math.floor(left / 86_400), Math.floor((left % 86_400) / 3600), Math.floor((left % 3600) / 60), left % 60);
  return (
    <span className="shop-tag time">
      <Icon name="comet" />
      <span>{t.endsIn(text)}</span>
    </span>
  );
}

function Featured({ product, firstPercent, reduced, onBuy }: { product: ShopProductView; firstPercent: number; reduced: boolean; onBuy: () => void }) {
  const why = blockText(product);
  return (
    <article className="lip panel shop-featured">
      <div className="shop-featured-art">
        <span className="shop-rays" aria-hidden="true" />
        <PackCanvas product={product} size={60} reduced={reduced} className="shop-featured-canvas" />
      </div>
      <div className="shop-featured-body">
        <div className="shop-tags">
          {product.badge ? <span className="shop-tag hot">{t.badges[product.badge]}</span> : null}
          {product.offer?.kind === 'bonus' ? <span className="shop-tag gift">{t.offerBonus(product.offer.percent)}</span> : null}
          {product.offer?.kind === 'price' ? <span className="shop-tag gift">{t.offerPrice}</span> : null}
          {product.first ? <span className="shop-tag gift">{t.first.tag(firstPercent)}</span> : null}
          {product.offer ? <Countdown endsAt={product.offer.endsAt} /> : null}
        </div>
        <h2 className="shop-featured-name">{product.name}</h2>
        <p className="shop-featured-what">{amountsText(product.total)}</p>
        <div className="shop-buyrow">
          <button type="button" className="lip pill pill-solar shop-featured-buy" disabled={why !== null} aria-label={why ?? t.buyOf(product.name, eur(product.priceCents))} onClick={onBuy}>
            {why ?? eur(product.priceCents)}
          </button>
          {product.beforeCents !== null ? <s className="shop-before">{t.before(eur(product.beforeCents))}</s> : null}
          {product.maxPerAccount === 1 ? <span className="shop-small">{t.once}</span> : null}
        </div>
      </div>
    </article>
  );
}

function TermsDialog({ shop, onClose }: { shop: ShopView; onClose: () => void }) {
  return (
    <Dialog title={t.legal.title} onClose={onClose} className="shop-terms">
      {shop.legal.seller ? <p>{t.legal.seller(shop.legal.seller, shop.legal.contact)}</p> : null}
      <ul className="shop-terms-list">
        {t.legal.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
        <li>{t.limit(eur(shop.limits.dailyCents))}</li>
      </ul>
      <button type="button" className="lip pill" onClick={onClose} data-autofocus>
        {copy.shop.checkout.close}
      </button>
    </Dialog>
  );
}

export function ShopScreen() {
  const shop = useShop();
  const reduced = useReducedMotion();
  const [params, setParams] = useSearchParams();
  const [buying, setBuying] = useState<ShopProductView | null>(null);
  const [terms, setTerms] = useState(false);
  const resume = params.get('compra');
  const fx = usePurchaseFx(reduced);
  const { celebrate } = fx;
  const v = shop.data;

  const tab = TABS.find((x) => x.slug === params.get('pestana'))?.tab ?? 'coins';
  const setTab = (next: Tab) =>
    setParams(
      (p) => {
        p.set('pestana', TABS.find((x) => x.tab === next)!.slug);
        return p;
      },
      { replace: true },
    );

  const onPaid = useCallback(
    (p: ShopPurchaseView) => {
      setBuying(null);
      if (resume) {
        setParams(
          (q) => {
            q.delete('compra');
            return q;
          },
          { replace: true },
        );
      }
      celebrate(p);
    },
    [celebrate, resume, setParams],
  );

  const header = (
    <header className="shop-bar">
      <BackLink fallback="/" />
      <h1 className="shop-title">{t.title}</h1>
      <div className="lip panel hud shop-wallet">
        <WalletBar wallet={v?.wallet} components />
      </div>
    </header>
  );

  if (!v) {
    return (
      <main className="screen shop-screen">
        {header}
        {shop.error ? <p className="field-error" role="alert">{errorText(shop.error, copy.errors)}</p> : null}
      </main>
    );
  }
  if (!v.open) {
    return (
      <main className="screen shop-screen">
        {header}
        <section className="lip panel shop-closed" role="status">
          <Icon name="store" />
          <h2>{v.closed === 'blocked' ? t.blocked : t.closed}</h2>
          {v.closed === 'blocked' ? null : <p>{t.closedHint}</p>}
        </section>
      </main>
    );
  }

  const featured = v.products.find((p) => p.featured && p.kind !== 'welcome') ?? null;
  const welcome = v.products.find((p) => p.kind === 'welcome' && p.block !== 'once_used') ?? null;
  const showFirst = v.firstPurchase.enabled && v.products.some((p) => p.first);
  const shown = v.products.filter((p) => p.tab === tab && p.kind !== 'welcome');
  // Back from Stripe's redirect, the dialog only waits for that purchase.
  const dialogProduct = resume ? null : buying;

  return (
    <main className="screen shop-screen">
      {header}
      {featured || welcome || showFirst ? (
        <section className={`shop-hero${featured ? '' : ' no-featured'}`}>
          {featured ? <Featured product={featured} firstPercent={v.firstPurchase.percent} reduced={reduced} onBuy={() => setBuying(featured)} /> : null}
          <div className="shop-side">
            {welcome ? (
              <article className="lip panel shop-welcome">
                <PackCanvas product={welcome} size={40} reduced={reduced} className="shop-welcome-art" />
                <div>
                  <h3>{t.welcome.title}</h3>
                  <p>{t.welcome.lead(amountsText(welcome.total))}</p>
                  <button
                    type="button"
                    className="lip pill pill-solar"
                    disabled={blockText(welcome) !== null}
                    aria-label={blockText(welcome) ?? t.buyOf(welcome.name, eur(welcome.priceCents))}
                    onClick={() => setBuying(welcome)}
                  >
                    {blockText(welcome) ?? eur(welcome.priceCents)}
                  </button>
                </div>
              </article>
            ) : null}
            {showFirst ? (
              <article className="lip panel shop-first">
                <span className="shop-first-mark" aria-hidden="true">
                  {v.firstPurchase.percent === 100 ? '×2' : `+${v.firstPurchase.percent} %`}
                </span>
                <div>
                  <h3>{t.first.title(v.firstPurchase.percent)}</h3>
                  <p>{t.first.lead(v.firstPurchase.percent)}</p>
                </div>
              </article>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="shop-tabs" role="tablist" aria-label={t.tabsLabel}>
        {TABS.map((x) => (
          <button
            key={x.tab}
            type="button"
            role="tab"
            id={`shop-tab-${x.tab}`}
            aria-selected={tab === x.tab}
            aria-controls="shop-grid"
            className={`lip shop-tab tone-${x.tab}`}
            onClick={() => setTab(x.tab)}
          >
            <Icon name={x.icon} />
            <span>{t.tabs[x.tab]}</span>
          </button>
        ))}
      </div>
      <section id="shop-grid" className="shop-grid" role="tabpanel" aria-labelledby={`shop-tab-${tab}`}>
        {shown.map((p, i) => (
          <ProductCard key={p.id} product={p} index={i} firstPercent={v.firstPurchase.percent} reduced={reduced} onBuy={setBuying} />
        ))}
      </section>

      <footer className="shop-foot">
        <span>{t.vat}</span>
        <button type="button" className="shop-link" onClick={() => setTerms(true)}>
          {t.terms}
        </button>
        <span>{t.limit(eur(v.limits.dailyCents))}</span>
      </footer>

      {dialogProduct || resume ? (
        <CheckoutDialog
          key={resume ?? dialogProduct!.id}
          product={dialogProduct}
          shop={v}
          reduced={reduced}
          resume={resume}
          onClose={() => {
            setBuying(null);
            if (resume) {
              setParams(
                (q) => {
                  q.delete('compra');
                  return q;
                },
                { replace: true },
              );
            }
          }}
          onPaid={onPaid}
          onTerms={() => setTerms(true)}
        />
      ) : null}
      {terms ? <TermsDialog shop={v} onClose={() => setTerms(false)} /> : null}
      {fx.view}
    </main>
  );
}
