import { type Gift, giftIssues } from '@galaxy/shared';
import { useState } from 'react';
import { copy } from '../copy/es';
import { GiftArt } from '../gifts/GiftArt';
import { GiftPicker } from '../gifts/GiftPicker';
import { GiftTray } from '../gifts/GiftTray';
import { type GiftCatalog, giftWords } from '../gifts/words';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';

// The gifts of a prize (plan «temporadas como fichas», part 5; shared since «Encuestas y avisos»): what a tournament's
// range of places, its participation prize or a popup's reward gives, shown as a strip of drawings with their words and
// chosen in a dialog with the mail's own picker and tray (mail v2). A prize never expires, so the picker offers only
// lasting gifts; a pack from the library adds its gifts (a record holds gifts, not packs).

const t = copy.admin.giftsField;

/** The most gifts one prize holds (a tournament record's own limit). */
export const MAX_PRIZE_GIFTS = 20;

/** The gifts in a line: each drawing with its words. */
export function GiftLine({ gifts, catalog }: { gifts: readonly Gift[]; catalog: GiftCatalog }) {
  if (gifts.length === 0) return <span className="admin-gifts-none">{t.none}</span>;
  return (
    <ul className="admin-gift-line">
      {gifts.map((g, i) => (
        <li key={i}>
          <GiftArt gift={g} catalog={catalog} compact />
          <span>{giftWords(g, catalog)}</span>
        </li>
      ))}
    </ul>
  );
}

export interface GiftsFieldProps {
  gifts: readonly Gift[];
  catalog: GiftCatalog;
  /** The dialog's title: whose gifts these are («Regalos del tramo 1.º»). */
  title: string;
  onChange: (gifts: Gift[]) => void;
  /** The most gifts it holds ({@link MAX_PRIZE_GIFTS} by default). */
  max?: number;
}

/** A prize's gifts in a line and «Elegir regalos», which opens the mail's picker and tray for lasting gifts. */
export function GiftsField({ gifts, catalog, title, onChange, max = MAX_PRIZE_GIFTS }: GiftsFieldProps) {
  const [open, setOpen] = useState(false);
  // Seasonal and event gifts are the record's own problem (a tournament's prize_gift_*), said on its step; the rest as
  // the mail does.
  const issues = giftIssues(gifts, catalog.live).filter((i) => i.code !== 'season_closed' && i.code !== 'event_closed');
  const full = gifts.length >= max;
  return (
    <div className="admin-gifts">
      <GiftLine gifts={gifts} catalog={catalog} />
      <button type="button" className="lip pill small" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Icon name="plus" />
        <span>{t.choose}</span>
      </button>
      {open ? (
        <Dialog title={title} className="admin-dialog admin-gifts-dialog" onClose={() => setOpen(false)}>
          <GiftTray items={gifts} packs={[]} catalog={catalog} issues={issues} maxItems={max} maxPacks={0} onRemove={(i) => onChange(gifts.filter((_, k) => k !== i))} onRemovePack={() => {}} />
          <GiftPicker
            catalog={catalog}
            lasting
            packsChosen={[]}
            itemsFull={full}
            packsFull={full}
            onAdd={(gift) => onChange(full ? [...gifts] : [...gifts, gift])}
            onAddPack={(id) => {
              const pack = catalog.packs.find((p) => p.id === id);
              if (pack) onChange([...gifts, ...pack.items].slice(0, Math.max(gifts.length, max)));
            }}
          />
          <p className="hint">{t.packsNote}</p>
          <button type="button" className="lip pill pill-solar admin-gifts-done" onClick={() => setOpen(false)}>
            {t.done}
          </button>
        </Dialog>
      ) : null}
    </div>
  );
}
