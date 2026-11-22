import type { PopupView } from '@galaxy/shared';
import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { copy } from '../copy/es';
import { linkTarget } from '../news/cards';
import { Icon } from '../ui/Icon';

// A promotion of «Encuestas y avisos» (plan 2026-11-22, part A; the owner's mock-up): the big image on top (16:9, never
// more than 40 % of the screen's height), the title in Solar display letters (the dialog's own heading), the text
// fading out when it does not fit, and the round Solar button at the corner. With a link it goes there (a screen of the
// game, or a web page in another tab) and counts as «Ver más»; its words slide out beside it under the pointer or the
// focus. Without one, it shows the whole text, or closes when everything is already in sight.

const t = copy.popups;

export function PromotionBody({ popup, onMore, onClose, inline }: { popup: PopupView; onMore: () => void; onClose: () => void; inline: boolean }) {
  const text = useRef<HTMLParagraphElement>(null);
  const [clamped, setClamped] = useState(false);
  const [open, setOpen] = useState(false);
  const target = linkTarget(popup.link);

  // Whether the text overflows its lines: measured again when the box changes size or the fonts arrive.
  useLayoutEffect(() => {
    const el = text.current;
    if (!el || open) return;
    let live = true;
    const measure = () => {
      if (live) setClamped(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    void document.fonts?.ready.then(measure);
    return () => {
      live = false;
      ro?.disconnect();
    };
  }, [open, popup.body]);

  // The preview of the panel never leaves it.
  const more = (e: { preventDefault: () => void }) => {
    if (inline) e.preventDefault();
    else onMore();
  };
  const chip = (words: string) => (
    <span className="pop-more-words" aria-hidden="true">
      {words}
    </span>
  );

  let button;
  if (target.href && target.external)
    button = (
      <a className="lip pop-more" href={target.href} target="_blank" rel="noopener noreferrer" aria-label={`${target.cta}. ${t.opensOutside}`} onClick={more}>
        {chip(target.cta)}
        <Icon name="next" />
      </a>
    );
  else if (target.href)
    button = (
      <Link className="lip pop-more" to={target.href} aria-label={target.cta} onClick={more}>
        {chip(target.cta)}
        <Icon name="next" />
      </Link>
    );
  else if (clamped && !open)
    button = (
      <button type="button" className="lip pop-more" aria-label={t.more} aria-expanded={false} onClick={() => setOpen(true)}>
        {chip(t.more)}
        <Icon name="down" />
      </button>
    );
  else
    button = (
      <button type="button" className="lip pop-more" aria-label={t.close} onClick={onClose}>
        {chip(t.close)}
        <Icon name="tick" />
      </button>
    );

  return (
    <>
      {popup.image ? <img className="pop-promo-art" src={popup.image} alt="" draggable={false} /> : null}
      <button type="button" className="lip pop-x" aria-label={t.close} onClick={onClose}>
        <Icon name="close" />
      </button>
      {popup.body ? (
        <div className={`pop-promo-body${clamped && !open ? ' clamped' : ''}${open ? ' open' : ''}`}>
          <p ref={text} className="pop-promo-text" tabIndex={open ? 0 : undefined}>
            {popup.body}
          </p>
        </div>
      ) : null}
      {button}
    </>
  );
}
