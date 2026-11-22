import type { BigGiftReason } from '@galaxy/shared';
import { type GiftCatalog, bigReasonText } from '../gifts/words';
import { Icon } from '../ui/Icon';

// Why a prize needs a superadmin (plan «temporadas como fichas», part 5; shared since «Encuestas y avisos»): a
// tournament's prizes or a popup's reward past the mail's limits, each reason in words, Solar when this admin is a
// superadmin and can go on, Nova when they must ask one. The words of its head come from whoever uses it.

export interface BigNoteWords {
  /** «Programarlo pide un superadmin». */
  title: string;
  /** What a superadmin reads. */
  you: string;
  /** What any other admin reads. */
  needs: string;
  /** A tournament's money prizes. */
  cash?: string;
}

/** Why publishing needs a superadmin, and whether this admin is one (nothing when no reason). */
export function BigNote({ reasons, superadmin, catalog, words }: { reasons: readonly (BigGiftReason | 'cash')[]; superadmin: boolean; catalog: GiftCatalog | null; words: BigNoteWords }) {
  if (reasons.length === 0) return null;
  return (
    <div className={`gift-big${superadmin ? ' ok' : ' bad'}`} role="status">
      <p className="gift-big-head">
        <Icon name={superadmin ? 'shield' : 'lock'} />
        <b>{words.title}</b>
        <span>{superadmin ? words.you : words.needs}</span>
      </p>
      <ul>
        {reasons.map((r) => (
          <li key={r}>{r === 'cash' ? (words.cash ?? r) : catalog ? bigReasonText(r, catalog) : r}</li>
        ))}
      </ul>
    </div>
  );
}
