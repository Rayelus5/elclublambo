import type { BigGiftReason, Gift, GiftIssue, PackCopy } from '@galaxy/shared';
import { copy } from '../copy/es';
import { giftUrl } from '../mail/art';
import { Icon } from '../ui/Icon';
import { GiftArt, GiftTile } from './GiftArt';
import { bigReasonText, type GiftCatalog, giftWords, issueText } from './words';

// What a message gives, as it is being made (mail v2, P3): the loose gifts and the packs, each with its drawing, its
// words, what is wrong with it (if anything) and «Quitar»; and, beside it, whether the whole is big enough to need a
// superadmin, and why.

const g = copy.gifts;
export const MAX_ITEMS = 20;
export const MAX_PACKS = 5;

export function GiftTray({
  items,
  packs,
  catalog,
  issues,
  onRemove,
  onRemovePack,
}: {
  items: readonly Gift[];
  packs: readonly PackCopy[];
  catalog: GiftCatalog;
  /** By index over the loose gifts and then each pack's (as `allGifts` lists them). */
  issues: readonly GiftIssue[];
  onRemove: (index: number) => void;
  onRemovePack: (id: string) => void;
}) {
  const problem = (index: number) => {
    const i = issues.find((x) => x.index === index);
    return i ? issueText(i.code) : null;
  };
  // Where each pack's gifts start in the issues' numbering (after the loose ones).
  const starts = packs.map((_, i) => items.length + packs.slice(0, i).reduce((n, p) => n + p.items.length, 0));
  return (
    <div className="gift-tray-wrap">
      <p className="gift-tray-count" aria-live="polite">
        <span>{g.tray.count(items.length, MAX_ITEMS)}</span>
        <span>{g.tray.packs(packs.length, MAX_PACKS)}</span>
      </p>
      {items.length === 0 && packs.length === 0 ? <p className="gift-tray-empty">{g.tray.empty}</p> : null}
      {items.length > 0 ? (
        <ul className="gift-tray">
          {items.map((gift, i) => (
            <GiftTile key={i} gift={gift} catalog={catalog} problem={problem(i)}>
              <button type="button" className="lip iconbtn small" aria-label={g.remove(giftWords(gift, catalog))} title={g.remove(giftWords(gift, catalog))} onClick={() => onRemove(i)}>
                <Icon name="close" />
              </button>
            </GiftTile>
          ))}
        </ul>
      ) : null}
      {packs.length > 0 ? (
        <ul className="gift-tray packs">
          {packs.map((p, k) => {
            const start = starts[k]!;
            const bad = issues.filter((x) => x.index >= start && x.index < start + p.items.length);
            return (
              <li key={p.id} className={`gift-tray-pack${bad.length ? ' bad' : ''}`}>
                <span className="gift-pack-art" aria-hidden="true" style={giftUrl ? { backgroundImage: `url(${giftUrl})` } : undefined} />
                <span className="gift-tile-words">
                  <b>{g.pack(p.name)}</b>
                  <small>{p.items.map((i) => giftWords(i, catalog)).join(', ')}</small>
                  {bad.map((x) => (
                    <small key={x.index} className="gift-tile-problem">
                      {issueText(x.code)}
                    </small>
                  ))}
                </span>
                <ul className="gift-pack-strip" aria-hidden="true">
                  {p.items.slice(0, 5).map((i, k) => (
                    <li key={k}>
                      <GiftArt gift={i} catalog={catalog} compact />
                    </li>
                  ))}
                </ul>
                <button type="button" className="lip iconbtn small" aria-label={g.remove(g.pack(p.name))} title={g.remove(g.pack(p.name))} onClick={() => onRemovePack(p.id)}>
                  <Icon name="close" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/** A big gift says so at once: why (with the config's limits) and whether whoever is writing may send it. */
export function BigGiftNote({ reasons, superadmin, catalog }: { reasons: readonly BigGiftReason[]; superadmin: boolean; catalog: GiftCatalog }) {
  if (reasons.length === 0) return null;
  return (
    <div className={`gift-big${superadmin ? ' ok' : ' bad'}`} role="status">
      <p className="gift-big-head">
        <Icon name={superadmin ? 'shield' : 'lock'} />
        <b>{g.big.title}</b>
        <span>{superadmin ? g.big.you : g.big.needs}</span>
      </p>
      <ul>
        {reasons.map((r) => (
          <li key={r}>{bigReasonText(r, catalog)}</li>
        ))}
      </ul>
    </div>
  );
}
