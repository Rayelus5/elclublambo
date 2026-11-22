import { type Gift, giftIssues } from '@galaxy/shared';
import { useState } from 'react';
import { GiftArt } from '../../gifts/GiftArt';
import { GiftPicker } from '../../gifts/GiftPicker';
import { GiftTray } from '../../gifts/GiftTray';
import { type GiftCatalog, giftWords } from '../../gifts/words';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { t } from './shared';

// The gifts of a prize (plan «temporadas como fichas», part 5): what a range of places or the participation prize gives,
// shown as a strip of drawings with their words and chosen in a dialog with the mail's own picker and tray (mail v2).
// A tournament's prizes never expire, so the picker offers only lasting gifts; a pack from the library adds its gifts
// (a record holds gifts, not packs).

/** The most gifts one prize holds (the record's own limit). */
export const MAX_PRIZE_GIFTS = 20;

/** The gifts in a line: each drawing with its words. */
export function GiftLine({ gifts, catalog }: { gifts: readonly Gift[]; catalog: GiftCatalog }) {
  if (gifts.length === 0) return <span className="tn-gifts-none">{t.noGifts}</span>;
  return (
    <ul className="tn-gift-line">
      {gifts.map((g, i) => (
        <li key={i}>
          <GiftArt gift={g} catalog={catalog} compact />
          <span>{giftWords(g, catalog)}</span>
        </li>
      ))}
    </ul>
  );
}

export function GiftsField({ gifts, catalog, title, onChange }: { gifts: readonly Gift[]; catalog: GiftCatalog; title: string; onChange: (gifts: Gift[]) => void }) {
  const [open, setOpen] = useState(false);
  // Seasonal and event gifts are the tournament's own problem (prize_gift_*), said on its step; the rest as the mail does.
  const issues = giftIssues(gifts, catalog.live).filter((i) => i.code !== 'season_closed' && i.code !== 'event_closed');
  const full = gifts.length >= MAX_PRIZE_GIFTS;
  return (
    <div className="tn-gifts">
      <GiftLine gifts={gifts} catalog={catalog} />
      <button type="button" className="lip pill small" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Icon name="plus" />
        <span>{t.chooseGifts}</span>
      </button>
      {open ? (
        <Dialog title={title} className="admin-dialog tn-gift-dialog" onClose={() => setOpen(false)}>
          <GiftTray items={gifts} packs={[]} catalog={catalog} issues={issues} maxItems={MAX_PRIZE_GIFTS} maxPacks={0} onRemove={(i) => onChange(gifts.filter((_, k) => k !== i))} onRemovePack={() => {}} />
          <GiftPicker
            catalog={catalog}
            lasting
            packsChosen={[]}
            itemsFull={full}
            packsFull={full}
            onAdd={(gift) => onChange(full ? [...gifts] : [...gifts, gift])}
            onAddPack={(id) => {
              const pack = catalog.packs.find((p) => p.id === id);
              if (pack) onChange([...gifts, ...pack.items].slice(0, Math.max(gifts.length, MAX_PRIZE_GIFTS)));
            }}
          />
          <p className="hint">{t.packsNote}</p>
          <button type="button" className="lip pill pill-solar tn-gift-done" onClick={() => setOpen(false)}>
            {t.giftsDone}
          </button>
        </Dialog>
      ) : null}
    </div>
  );
}
