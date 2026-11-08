import { MAIL_GIFTS, type MailGift, type MailMessage } from '@galaxy/shared';
import { type CSSProperties, useState } from 'react';
import { useClaimMail, useMailbox, useReadMail } from '../api/mail';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { Dialog } from '../ui/Dialog';
import { Icon, type IconName } from '../ui/Icon';
import { giftUrl } from './art';

const t = copy.mail;
const day = (iso: string) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' }).format(new Date(iso));
const GIFT_ICON: Record<MailGift, IconName> = { coins: 'coin', dust: 'dust', signal: 'ticket' };
const giftLabel = (k: MailGift, n: number) => (k === 'coins' ? copy.hub.resource.coins(n) : k === 'dust' ? copy.hub.resource.dust(n) : copy.hub.resource.signal(n));
const gifted = (m: MailMessage) => MAIL_GIFTS.filter((k) => (m.gifts[k] ?? 0) > 0);

/**
 * The top bar's mailbox (GDD §4, §16.5; DESIGN_SYSTEM §8 vicies): its name says how many are unread (one atomic
 * label, no competing live region) and a Solar badge shows the number; it opens the mailbox.
 */
export function MailButton({ style }: { style?: CSSProperties }) {
  const box = useMailbox();
  const [open, setOpen] = useState(false);
  const unread = box.data?.unread ?? 0;
  const label = unread > 0 ? t.unread(unread) : t.button;
  return (
    <>
      <button type="button" className="lip iconbtn enter mail-button" style={style} aria-label={label} title={label} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Icon name="mail" />
        {unread > 0 ? (
          <span className="mail-badge" aria-hidden="true">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>
      {open ? <MailboxDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** The mailbox: the messages on the left (new ones marked in words), the one open on the right with its gift. */
export function MailboxDialog({ onClose }: { onClose: () => void }) {
  const box = useMailbox();
  const read = useReadMail();
  const [openId, setOpenId] = useState<string | null>(null);
  const messages = box.data?.messages ?? [];
  const current = messages.find((m) => m.id === openId) ?? null;
  const pick = (m: MailMessage) => {
    setOpenId(m.id);
    if (!m.read) read.mutate(m.id);
  };
  return (
    <Dialog title={t.title} onClose={onClose} className="mailbox">
      <button type="button" className="lip iconbtn modal-close" aria-label={t.close} title={t.close} onClick={onClose}>
        <Icon name="close" />
      </button>
      {box.error ? (
        <p className="field-error" role="alert">
          {errorText(box.error, copy.errors)}
        </p>
      ) : null}
      {box.data && messages.length === 0 ? (
        <p className="mailbox-empty">
          <Icon name="mail" />
          <span>{t.empty}</span>
        </p>
      ) : null}
      {messages.length > 0 ? (
        <div className="mailbox-body">
          <ul className="mailbox-list" aria-label={t.listLabel}>
            {messages.map((m) => (
              <li key={m.id}>
                <button type="button" className={`mailbox-item${m.id === openId ? ' open' : ''}${m.read ? '' : ' unread'}`} aria-current={m.id === openId || undefined} onClick={() => pick(m)}>
                  <span className="mailbox-item-title">{m.title}</span>
                  <span className="mailbox-item-meta">
                    <time dateTime={m.at}>{day(m.at)}</time>
                    {m.read ? null : <span className="mailbox-new">{t.new}</span>}
                    {gifted(m).length && !m.claimed ? <span className="mailbox-has-gift">{t.hasGift}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mailbox-detail">{current ? <Letter key={current.id} m={current} /> : <p className="mailbox-pick">{t.pick}</p>}</div>
        </div>
      ) : null}
    </Dialog>
  );
}

/** One message: its title, date and text as written; its gift, collected once. */
function Letter({ m }: { m: MailMessage }) {
  const claim = useClaimMail();
  // Claimed here: kept even before the mailbox is read again.
  const [taken, setTaken] = useState(false);
  const gifts = gifted(m);
  const claimed = m.claimed || taken;
  return (
    <article className="letter">
      <h3>{m.title}</h3>
      <p className="letter-meta">
        <time dateTime={m.at}>{day(m.at)}</time>
        <span>{t.expires(day(m.expiresAt))}</span>
      </p>
      <p className="letter-body">{m.body}</p>
      {gifts.length ? (
        <section className={`gift${claimed ? ' taken' : ''}`} aria-label={t.giftTitle}>
          <span className="gift-art" aria-hidden="true" style={giftUrl ? { backgroundImage: `url(${giftUrl})` } : undefined} />
          <ul className="gift-items">
            {gifts.map((k) => (
              <li key={k} className={`gift-item ${k}`}>
                <Icon name={GIFT_ICON[k]} />
                <span>{giftLabel(k, m.gifts[k] ?? 0)}</span>
              </li>
            ))}
          </ul>
          {claimed ? (
            <p className="gift-done" role="status">
              <Icon name="check" />
              <span>{t.claimed}</span>
            </p>
          ) : (
            <button type="button" className="lip pill pill-solar" disabled={claim.isPending} aria-busy={claim.isPending || undefined} onClick={() => claim.mutate(m.id, { onSuccess: () => setTaken(true) })}>
              {t.claim}
            </button>
          )}
          {claim.error ? (
            <p className="field-error" role="alert">
              {errorText(claim.error, copy.errors)}
            </p>
          ) : null}
        </section>
      ) : null}
    </article>
  );
}
