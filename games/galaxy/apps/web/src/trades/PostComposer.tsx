import { type GalaxySummary, TIERS, type Tier, type TradeBoardRules, type TradeWants } from '@galaxy/shared';
import { useId, useState } from 'react';
import { useGacha } from '../api/economy';
import { useCreatePost } from '../api/trades';
import { errorText } from '../auth/useMe';
import { GalaxyCard } from '../cards/GalaxyCard';
import { GalaxyPicker } from '../cards/GalaxyPicker';
import { FilterSelect, phenomenonOptions, traitOptions } from '../collection/Filters';
import { copy } from '../copy/es';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';

const t = copy.trades;
const b = t.board;
const heldElsewhere = (g: GalaxySummary) => g.equipped === true || g.exhibited === true || g.listed === true || g.traded === true;

/**
 * Posting on the trade board (2026-11-14): «Doy» (up to `tradeGalaxies` of mine and/or coins) and «Busco» (rarities, a
 * type, a palette, a phenomenon, coins; nothing marked listens to any proposal), a short note, how long it lasts and
 * that nothing is held until an answer is accepted.
 */
export function PostComposer({ rules, max, onClose }: { rules: TradeBoardRules; max: number; onClose: () => void }) {
  const ids = useId();
  const coins = useGacha().data?.wallet.coins;
  const create = useCreatePost();
  const [galaxies, setGalaxies] = useState<GalaxySummary[]>([]);
  const [coinsText, setCoinsText] = useState('');
  const [wants, setWants] = useState<TradeWants>({ tiers: [], coins: false });
  const [note, setNote] = useState('');
  const [picking, setPicking] = useState(false);
  const amount = coinsText.trim() === '' ? 0 : /^\d{1,10}$/.test(coinsText.trim()) ? Number(coinsText.trim()) : NaN;
  const short = coins !== undefined && amount > coins ? amount - coins : 0;
  const gives = galaxies.length > 0 || amount > 0;
  const valid = gives && Number.isFinite(amount) && short === 0 && note.length <= 140 && !(amount > 0 && wants.coins);
  const toggleTier = (tier: Tier) => setWants((w) => ({ ...w, tiers: w.tiers.includes(tier) ? w.tiers.filter((x) => x !== tier) : [...w.tiers, tier] }));
  const setTrait = (key: 'type' | 'palette' | 'phenomenon', v: string | undefined) =>
    setWants((w) => {
      const next = { ...w };
      if (v) next[key] = v;
      else delete next[key];
      return next;
    });
  const done = create.data;

  return (
    <Dialog title={b.publishTitle} onClose={onClose} className="trade-composer post-composer">
      {done ? (
        <>
          <p className="market-bought" role="status">
            <Icon name="check" />
            <span>{b.sent}</span>
          </p>
          <div className="confirm-actions">
            <button type="button" className="lip pill pill-solar" data-autofocus onClick={onClose}>
              {copy.collection.close}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="trade-sides">
            <section className="trade-slot trade-column" aria-label={b.give}>
              <h3>{b.give}</h3>
              <ul className={`trade-cards n${galaxies.length}`}>
                {galaxies.map((g) => (
                  <li key={g.id}>
                    <GalaxyCard galaxy={g} size={galaxies.length > 1 ? 120 : 160} />
                    <button type="button" className="lip pill small trade-remove" aria-label={t.remove(g.name)} onClick={() => setGalaxies((x) => x.filter((y) => y.id !== g.id))}>
                      <Icon name="close" />
                    </button>
                  </li>
                ))}
                {galaxies.length === 0 ? (
                  <li>
                    <div className="trade-empty">{t.nothing}</div>
                  </li>
                ) : null}
              </ul>
              {galaxies.length < max ? (
                <button type="button" className="lip pill small" aria-haspopup="dialog" onClick={() => setPicking(true)}>
                  <Icon name="plus" />
                  <span>{t.chooseMine}</span>
                </button>
              ) : (
                <p className="panel-note">{t.upTo(max)}</p>
              )}
              <div className="field trade-coins">
                <label htmlFor={`${ids}-coins`}>{t.giveCoins}</label>
                <div className="control">
                  <input
                    id={`${ids}-coins`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    placeholder="0"
                    value={coinsText}
                    disabled={wants.coins}
                    aria-describedby={`${ids}-coins-hint`}
                    aria-invalid={!Number.isFinite(amount) || short > 0 || undefined}
                    onChange={(e) => setCoinsText(e.target.value)}
                  />
                </div>
                <p className="hint" id={`${ids}-coins-hint`}>
                  {wants.coins ? t.coinsOneSide : short > 0 ? copy.market.missing(short) : t.coinsOneSide}
                </p>
              </div>
            </section>
            <span className="trade-arrows" aria-hidden="true" />
            <section className="trade-slot trade-column post-seek" aria-label={b.seek}>
              <h3>{b.seek}</h3>
              <fieldset className="post-tiers">
                <legend>{b.tiers}</legend>
                {TIERS.map((tier) => (
                  <button key={tier} type="button" className="chip" data-tier={tier} aria-pressed={wants.tiers.includes(tier)} onClick={() => toggleTier(tier)}>
                    <i aria-hidden="true" />
                    {copy.tiers[tier]}
                  </button>
                ))}
              </fieldset>
              <div className="post-traits">
                <FilterSelect label={copy.traitNames['galaxy_type']!} value={wants.type} options={traitOptions('galaxy_type')} onChange={(v) => setTrait('type', v)} />
                <FilterSelect label={copy.traitNames['palette']!} value={wants.palette} options={traitOptions('palette')} onChange={(v) => setTrait('palette', v)} />
                <FilterSelect label={copy.traitNames['phenomenon']!} value={wants.phenomenon} options={phenomenonOptions()} onChange={(v) => setTrait('phenomenon', v)} />
              </div>
              <button type="button" className="chip post-coins-ok" aria-pressed={wants.coins} disabled={amount > 0} onClick={() => setWants((w) => ({ ...w, coins: !w.coins }))}>
                <Icon name="coin" />
                {b.coinsOk}
              </button>
              <p className="panel-note">{b.seekHint}</p>
            </section>
          </div>
          <div className="field">
            <label htmlFor={`${ids}-note`}>{b.note}</label>
            <div className="control">
              <textarea id={`${ids}-note`} rows={2} maxLength={140} value={note} aria-describedby={`${ids}-note-hint`} onChange={(e) => setNote(e.target.value)} />
            </div>
            <p className="hint" id={`${ids}-note-hint`}>
              {b.noteHint(note.length)}
            </p>
          </div>
          <p className="panel-note">
            {b.lasts(rules.days)} · {b.left(rules.openLeft, rules.todayLeft)}
          </p>
          {create.error ? (
            <p className="field-error" role="alert">
              {errorText(create.error, copy.errors)}
            </p>
          ) : null}
          <div className="confirm-actions">
            <button type="button" className="lip pill" onClick={onClose}>
              {t.keep}
            </button>
            <button
              type="button"
              className="lip pill pill-solar"
              disabled={!valid || create.isPending}
              aria-busy={create.isPending || undefined}
              onClick={() => create.mutate({ give: { galaxies: galaxies.map((g) => g.id), coins: amount || 0 }, wants, note: note.trim() })}
            >
              {b.send}
            </button>
          </div>
        </>
      )}
      {picking ? (
        <GalaxyPicker
          text={{ title: t.pickMine, empty: t.mineEmpty, pick: t.giveOne, taken: t.unavailable }}
          taken={new Set(galaxies.map((g) => g.id))}
          isTaken={heldElsewhere}
          onPick={(g) => {
            setGalaxies((x) => [...x, g].slice(0, max));
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
          className="relic-picker"
        />
      ) : null}
    </Dialog>
  );
}
