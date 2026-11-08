import { commissionOf, type GalaxySummary, type MarketRules } from '@galaxy/shared';
import { useId, useState } from 'react';
import { useGalaxyDetail } from '../api/economy';
import { useListGalaxy } from '../api/market';
import { errorText } from '../auth/useMe';
import { GalaxyCard } from '../cards/GalaxyCard';
import { GalaxyPicker } from '../cards/GalaxyPicker';
import { copy } from '../copy/es';

const t = copy.market;
const held = (g: GalaxySummary) => g.equipped === true || g.exhibited === true || g.listed === true || g.traded === true;

/**
 * Selling (DESIGN_SYSTEM §8 quattuordecies): a free galaxy (not equipped, exhibited or already for sale), then its
 * price, which starts at its rarity's floor; the field says the floor, what the commission leaves and, once left,
 * what is wrong. `preselected` comes from a galaxy's «Vender» in the collection.
 */
export function SellPanel({ rules, preselected, gateId }: { rules: MarketRules; preselected: string | null; gateId: string | undefined }) {
  const fieldId = useId();
  const hintId = useId();
  const errId = useId();
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<GalaxySummary | null>(null);
  // null until the player types: the field then shows the floor of the chosen galaxy's rarity.
  const [raw, setRaw] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const list = useListGalaxy();
  const pre = useGalaxyDetail(preselected && !chosen && !done ? preselected : undefined);
  const g = chosen ?? (pre.data && !held(pre.data) ? pre.data : null);
  const min = g ? rules.minPrice[g.tier] : 0;
  const value = raw ?? (g ? String(min) : '');
  const price = /^\d+$/.test(value) ? Number(value) : NaN;
  const problem = !Number.isSafeInteger(price) ? t.tooLow(min) : price < min ? t.tooLow(min) : price > rules.maxPrice ? t.tooHigh(rules.maxPrice) : null;
  const canList = rules.canTrade && rules.listingsLeft > 0 && g !== null && problem === null && !list.isPending;

  function pick(next: GalaxySummary): void {
    setChosen(next);
    setRaw(null);
    setTouched(false);
    setPicking(false);
    setDone(null);
    list.reset();
  }

  return (
    <section className="lip panel market-sell" aria-labelledby={`${fieldId}-title`}>
      <h2 id={`${fieldId}-title`}>{copy.market.tabs.sell}</h2>
      {done ? (
        <p className="market-listed" role="status">
          {done}
        </p>
      ) : null}
      <div className="market-sell-grid">
        <div className="market-sell-pick">
          {g ? <GalaxyCard galaxy={g} size={200} /> : <div className="market-sell-empty" aria-hidden="true" />}
          <button type="button" className="lip pill" onClick={() => setPicking(true)}>
            {g ? t.change : t.choose}
          </button>
          <p className="panel-note">{t.sellHint}</p>
        </div>
        {g ? (
          <form
            className="market-sell-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!canList) return;
              list.mutate(
                { galaxyId: g.id, price },
                {
                  onSuccess: () => {
                    setDone(t.listed(g.name, rules.days));
                    setChosen(null);
                    setRaw(null);
                    setTouched(false);
                  },
                },
              );
            }}
          >
            <p className="market-card-name">
              <b>{g.name}</b>
              <span>{copy.tiers[g.tier]}</span>
            </p>
            <div className={`field${touched && problem ? ' bad' : ''}`}>
              <label htmlFor={fieldId}>{t.priceLabel}</label>
              <div className="control">
                <input
                  id={fieldId}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={value}
                  aria-invalid={touched && problem ? true : undefined}
                  aria-describedby={touched && problem ? errId : hintId}
                  onChange={(e) => {
                    setRaw(e.target.value.replace(/[^\d]/g, ''));
                    if (list.error) list.reset();
                  }}
                  onBlur={() => setTouched(true)}
                />
              </div>
              {touched && problem ? (
                <p id={errId} className="field-error">
                  {problem}
                </p>
              ) : (
                <p id={hintId} className="hint">
                  {t.minHint(min)}
                </p>
              )}
            </div>
            {problem === null ? <p className="market-net">{t.net(price - commissionOf(price, rules.commission))}</p> : null}
            <button type="submit" className="lip pill pill-solar" disabled={!canList} aria-describedby={!rules.canTrade ? gateId : undefined}>
              {t.list}
            </button>
            <p className="panel-note">{t.listingsLeft(rules.listingsLeft)}</p>
            {list.error ? (
              <p className="field-error" role="alert">
                {errorText(list.error, copy.errors)}
              </p>
            ) : null}
          </form>
        ) : null}
      </div>
      {picking ? (
        <GalaxyPicker
          text={{ title: t.pickTitle, empty: t.pickEmpty, pick: t.pickOne, taken: t.unavailable }}
          taken={new Set()}
          isTaken={held}
          onPick={pick}
          onClose={() => setPicking(false)}
          className="relic-picker"
        />
      ) : null}
    </section>
  );
}
