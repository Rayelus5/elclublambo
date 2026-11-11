import { SHOP_CURRENCIES, type ShopAmounts, type ShopPurchaseView } from '@galaxy/shared';
import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getSettings, sfxOut } from '../audio/mixer';
import { noise, tone } from '../audio/synth';
import { copy } from '../copy/es';
import { Celebration } from '../ui/Celebration';
import { Icon } from '../ui/Icon';
import { amountsText, CURRENCY_ICON } from './ProductCard';

// A purchase delivered (shop and lab plan, F5; the approved F0 mockup): the celebration (a flash, sparks and the
// banner with what arrived), the resources flying from the middle of the screen into the wallet, more of them the
// bigger the pack, each landing with a rising tick, and a fanfare. The wallet then counts up (WalletBar). With reduced
// motion: the banner alone and one soft chime.

type Chip = { id: number; kind: keyof ShopAmounts; x: number; y: number; dx: number; dy: number; delay: number };
const FLIGHT_MS = 900;
let next = 0;

/** How many chips fly for an amount: a few for a small pack, up to 18 for the biggest. */
export function chipsFor(amount: number): number {
  if (amount <= 0) return 0;
  return Math.max(4, Math.min(18, Math.round(Math.log2(amount / 60)) + 3));
}

function playPurchase(total: ShopAmounts, reduced: boolean): void {
  const bus = sfxOut();
  if (!bus || getSettings().muted) return;
  const { ctx, out } = bus;
  const t = ctx.currentTime;
  if (reduced) {
    tone(ctx, out, t, 784, 784, 0.6, 0.04, 'sine');
    tone(ctx, out, t + 0.1, 1175, 1175, 0.6, 0.025, 'sine');
    return;
  }
  // The pop, then each currency landing (rising), then the fanfare.
  tone(ctx, out, t, 330, 990, 0.18, 0.06, 'triangle');
  noise(ctx, out, t, 0.25, 0.12, 2200);
  let at = t + 0.55;
  for (const c of SHOP_CURRENCIES) {
    const n = Math.min(10, chipsFor(total[c]));
    for (let i = 0; i < n; i++) {
      const hz = (c === 'coins' ? 1568 : c === 'dust' ? 1319 : 988) * 2 ** (i / 12);
      tone(ctx, out, at + i * 0.06, hz, hz, 0.08, 0.022, c === 'components' ? 'square' : 'sine');
    }
    if (n > 0) at += n * 0.06 + 0.05;
  }
  [523.3, 659.3, 784, 1046.5].forEach((hz, i) => tone(ctx, out, at + i * 0.1, hz, hz, 0.55, 0.045, 'triangle'));
  [523.3, 659.3, 784, 1046.5].forEach((hz) => tone(ctx, out, at + 0.45, hz, hz, 1.2, 0.028, 'sine'));
}

/** The celebration of a purchase: show it with `celebrate(purchase)`; it ends by itself or with a click. */
export function usePurchaseFx(reduced: boolean) {
  const [shown, setShown] = useState<ShopPurchaseView | null>(null);
  const [chips, setChips] = useState<Chip[]>([]);

  const celebrate = useCallback(
    (p: ShopPurchaseView) => {
      setShown(p);
      playPurchase(p.grants, reduced);
      if (reduced || typeof document === 'undefined') return;
      const x = window.innerWidth / 2;
      const y = window.innerHeight * 0.45;
      const made: Chip[] = [];
      SHOP_CURRENCIES.forEach((kind, k) => {
        const to = document.querySelector(`.shop-wallet .res.${kind}`)?.getBoundingClientRect();
        const tx = to ? to.left + 14 : window.innerWidth - 80;
        const ty = to ? to.top + to.height / 2 : 40;
        const n = chipsFor(p.grants[kind]);
        for (let i = 0; i < n; i++) {
          const spread = (i - n / 2) * 9;
          made.push({ id: ++next, kind, x: x + spread, y: y + ((i * 37) % 40) - 20, dx: tx - x - spread, dy: ty - y, delay: 450 + k * 160 + i * 55 });
        }
      });
      setChips(made);
    },
    [reduced],
  );

  useEffect(() => {
    if (!shown) return;
    const end = setTimeout(() => setShown(null), 3400);
    const clear = setTimeout(() => setChips([]), 450 + 3 * 160 + 18 * 55 + FLIGHT_MS + 300);
    return () => {
      clearTimeout(end);
      clearTimeout(clear);
    };
  }, [shown]);

  const view =
    typeof document === 'undefined'
      ? null
      : createPortal(
          <>
            {shown ? (
              <button type="button" className="shop-celebrate" onClick={() => setShown(null)} aria-label={copy.shop.celebrate.continue}>
                <Celebration title={amountsText(shown.grants)} subtitle={copy.shop.celebrate.sub(shown.name)} reduced={reduced} />
              </button>
            ) : null}
            {chips.length > 0 ? (
              <div className="claim-fx" aria-hidden="true">
                {chips.map((c) => (
                  <span
                    key={c.id}
                    className={`claim-chip shop-chip ${c.kind}`}
                    style={{ left: `${c.x}px`, top: `${c.y}px`, '--dx': `${c.dx}px`, '--dy': `${c.dy}px`, animationDelay: `${c.delay}ms` } as CSSProperties}
                  >
                    <Icon name={CURRENCY_ICON[c.kind]} />
                  </span>
                ))}
              </div>
            ) : null}
          </>,
          document.body,
        );
  return { celebrate, view, celebrating: shown !== null };
}
