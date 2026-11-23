import { type ChoiceBlocked, choiceNeedsPick, pieceName as launchName, type PrizeChoice, resolvePrizeChoice } from '@galaxy/shared';
import { type CSSProperties, useId, useState } from 'react';
import { useCosmeticsView } from '../api/cosmetics';
import { copy } from '../copy/es';
import { PieceArt } from '../cosmetics/PieceArt';
import { pieceName } from '../gifts/words';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { useReducedMotion } from '../ui/motion';
import { SpriteLoop } from '../ui/SpriteLoop';
import { choicePack, choiceWords, feeWords } from './words';

// Skins to choose as a tournament prize (plan «Torneo Navideño», C2; GDD §13.3; DESIGN_SYSTEM §8 quinquagies bis): the
// prize drawn as a strip of its skins with its words (the page's prize table and my prize), a small mark for the cards
// and the title screen, and the window where the winner picks them when they collect. In the window the skins they
// already have, or that are no longer live, are greyed out with the reason in words; the counter says how many are
// picked, and «Recoger con estas» waits for exactly the number the prize gives. With one to pick, another click swaps it;
// with more, the rest wait until one is taken off. Every option stays reachable by Tab, with its state for screen
// readers (aria-pressed, aria-disabled), and the focus starts on the first one that can be picked. Classes: `tch-`.

const c = copy.tournaments.choice;
const STRIP = 4;

/** The live catalog's name of a skin (the launch catalog's until it comes). */
function useSkinName(): (id: string) => string {
  const catalog = useCosmeticsView().data?.catalog;
  return (id) => (catalog ? pieceName('skin', id, catalog) : launchName('skin', id));
}

/**
 * What collecting a choice gives without asking (nothing to pick), in a line: the ones already owned or no longer live
 * and what they pay. Null when the window has to ask, or when everything is given.
 */
export function autoNote(choice: PrizeChoice, blocked: ChoiceBlocked): string | null {
  if (choiceNeedsPick(choice, blocked)) return null;
  const r = resolvePrizeChoice(choice, blocked);
  if ('error' in r || r.missing === 0) return null;
  const paid = r.compensation ? feeWords(r.compensation) : null;
  // Short because of what the winner owns (the usual case), or because some were switched off since.
  const owned = choice.options.filter((id) => blocked.owned.includes(id)).length;
  if (!choice.options.some((id) => blocked.unavailable.includes(id))) return paid ? c.ownedPaid(owned, paid) : c.ownedNone(owned);
  return paid ? c.missingPaid(r.missing, paid) : c.missingNone(r.missing);
}

/**
 * The prize as a tile: a strip of its first skins (moving, still with reduced motion) and its words, with what each
 * missing one pays. `note` replaces that second line (what collecting it now gives). `size`: the side table's (sm) or
 * my prize's (md).
 */
export function ChoiceTile({ choice, note, size = 'sm' }: { choice: PrizeChoice; note?: string | null; size?: 'sm' | 'md' }) {
  const reduced = useReducedMotion();
  const words = choiceWords(choice);
  const shown = choice.options.slice(0, STRIP);
  const more = choice.options.length - shown.length;
  const second = note === undefined ? words.rule : note;
  return (
    <li className={`gift-tile tch-tile ${size}`}>
      <span className="tch-strip" aria-hidden="true">
        {shown.map((id) => (
          <span key={id} className="tch-chip">
            <SpriteLoop className="tch-sprite" id={id} scale={size === 'md' ? 2 : 1} reduced={reduced} width={size === 'md' ? 48 : 24} height={size === 'md' ? 48 : 24} />
          </span>
        ))}
        {more > 0 ? <span className="tch-chip tch-more">{copy.tournaments.more(more)}</span> : null}
      </span>
      <span className="gift-tile-words">
        <span>{words.title}</span>
        {second ? <small>{second}</small> : null}
      </span>
    </li>
  );
}

/** The prize in short (a card's strip, the title screen's first prize): its first skin and how many, with its words. */
export function ChoiceMark({ choice }: { choice: PrizeChoice }) {
  const reduced = useReducedMotion();
  const { title } = choiceWords(choice);
  const first = choice.options[0];
  return (
    <span className="tn-prize-gift" title={title}>
      <span className="gift-ico tch-mark" aria-hidden="true">
        {first ? <SpriteLoop className="tch-sprite" id={first} scale={1} reduced={reduced} width={24} height={24} /> : <Icon name="probe" />}
        <b className="gift-count">×{choice.count}</b>
      </span>
      <span className="sr-only">{title}</span>
    </span>
  );
}

/**
 * The window that picks the skins. `blocked`: the ones the winner has and the ones no longer live (refreshed after a
 * refusal, which drops them from the pick). `onConfirm` gets the picked ones in the options' order.
 */
export function ChoiceDialog({
  choice,
  blocked,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  choice: PrizeChoice;
  blocked: ChoiceBlocked;
  busy: boolean;
  error: string | null;
  onConfirm: (picked: string[]) => void;
  onClose: () => void;
}) {
  const nameOf = useSkinName();
  const status = useId();
  const [picked, setPicked] = useState<string[]>([]);
  const owned = new Set(blocked.owned);
  const off = new Set(blocked.unavailable);
  const free = choice.options.filter((id) => !owned.has(id) && !off.has(id));
  // A pick that is no longer free (the page read again after a refusal) is dropped.
  const live = picked.filter((id) => free.includes(id));
  const full = live.length >= choice.count;
  const swap = choice.count === 1;
  const toggle = (id: string) => {
    if (!free.includes(id) || busy) return;
    // From the latest pick, so two quick clicks both count.
    setPicked((prev) => {
      const now = prev.filter((x) => free.includes(x));
      if (now.includes(id)) return now.filter((x) => x !== id);
      if (swap) return [id];
      return now.length < choice.count ? [...now, id] : now;
    });
  };
  const cols = choice.options.length <= 4 ? choice.options.length : choice.options.length <= 6 ? 3 : 4;
  const pack = choicePack(choice.options);
  const ready = live.length === choice.count;
  return (
    <Dialog title={c.title(choice.count)} className="tch-dialog" onClose={onClose}>
      <p className="tch-lead">{c.lead(pack, free.length)}</p>
      <ul className="tch-grid" data-cols={cols} aria-label={c.optionsLabel}>
        {choice.options.map((id, i) => {
          const on = live.includes(id);
          const why = owned.has(id) ? 'owned' : off.has(id) ? 'off' : null;
          const waits = !why && !on && full && !swap;
          return (
            <li key={id} className="tch-cell" style={{ '--i': i } as CSSProperties}>
              <button
                type="button"
                className={`tch-option${on ? ' on' : ''}${why ? ` ${why}` : ''}${waits ? ' waits' : ''}`}
                aria-pressed={on}
                aria-disabled={why || waits ? true : undefined}
                aria-describedby={status}
                data-autofocus={id === free[0] ? true : undefined}
                onClick={() => toggle(id)}
              >
                <span className="tch-stage">
                  <PieceArt piece={{ kind: 'skin', id }} size={96} />
                </span>
                <b className="tch-name">{nameOf(id)}</b>
                {/* A space, so its name reads «Lumen de Navidad Ya la tienes». */}
                {why ? ' ' : null}
                {why ? (
                  <span className="tch-why">
                    <Icon name={why === 'owned' ? 'check' : 'close'} />
                    <span>{why === 'owned' ? c.owned : c.off}</span>
                  </span>
                ) : null}
                <span className="tch-tick" aria-hidden="true">
                  <Icon name="check" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p className="field-error tch-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="tch-foot">
        <p id={status} className={`tch-count${ready ? ' ready' : ''}`} role="status" aria-atomic="true">
          <span className="tch-pips" aria-hidden="true">
            {Array.from({ length: choice.count }, (_, k) => (
              <i key={k} className={k < live.length ? 'on' : undefined} />
            ))}
          </span>
          <b aria-hidden="true">{c.count(live.length, choice.count)}</b>
          <span className="sr-only">{c.countLabel(live.length, choice.count)}</span>
          {full && !swap ? <small>{c.full}</small> : null}
        </p>
        <div className="modal-actions tch-actions">
          <button type="button" className="lip pill" onClick={onClose}>
            {c.cancel}
          </button>
          <button
            type="button"
            className="lip pill pill-solar"
            data-claim="tournament-choice"
            disabled={!ready || busy}
            aria-busy={busy || undefined}
            onClick={() => onConfirm(choice.options.filter((id) => live.includes(id)))}
          >
            <Icon name="trophy" />
            <span>{c.confirm(choice.count)}</span>
          </button>
        </div>
      </div>
    </Dialog>
  );
}
