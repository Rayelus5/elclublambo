import { hasAnyGift, type MailMessage } from '@galaxy/shared';
import { type CSSProperties, useState } from 'react';
import { useClaimMail, useMailbox, useReadMail } from '../api/mail';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { Dialog } from '../ui/Dialog';
import { usePlayerGiftView } from '../gifts/usePlayerGiftView';
import { Icon } from '../ui/Icon';
import { LetterView } from './LetterView';

const t = copy.mail;
const day = (iso: string) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' }).format(new Date(iso));

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
                    {hasAnyGift(m.contents) && !m.claimed ? <span className="mailbox-has-gift">{t.hasGift}</span> : null}
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

/** One message (mail v2): its kind's stamp, title, date and text as written; every gift it gives, collected once. */
function Letter({ m }: { m: MailMessage }) {
  const claim = useClaimMail();
  const view = usePlayerGiftView();
  // Claimed here: kept even before the mailbox is read again.
  const [taken, setTaken] = useState(false);
  const claimed = m.claimed || taken;
  return (
    <LetterView type={m.type} title={m.title} body={m.body} at={m.at} expiresAt={m.expiresAt} contents={m.contents} catalog={view} taken={claimed}>
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
    </LetterView>
  );
}
