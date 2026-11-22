import { type GrantedItem, hasAnyGift, type MailMessage, type MailType } from '@galaxy/shared';
import { type CSSProperties, type KeyboardEvent, useMemo, useRef, useState } from 'react';
import { useArchiveMail, useClaimAllMail, useClaimMail, useDeleteMail, useMailbox, useMailboxPages, useReadMail } from '../api/mail';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { usePlayerGiftView } from '../gifts/usePlayerGiftView';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { GiftReveal } from './GiftReveal';
import { LetterView } from './LetterView';
import { MAIL_TYPE_LOOK, mailTypeName } from './types';

const t = copy.mail;
const day = (iso: string) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' }).format(new Date(iso));
const BOXES = ['inbox', 'archive'] as const;
type Box = (typeof BOXES)[number];

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

/**
 * The mailbox (mail v2, P6): the inbox and the archive; a filter by kind with how many of each; the messages on the
 * left, each with its kind's icon and colour, new, with a gift or about to expire; the one open on the right with its
 * gift. «Recoger todo» collects every gift at once, and a claim shows what each gift gave.
 */
export function MailboxDialog({ onClose }: { onClose: () => void }) {
  const [box, setBox] = useState<Box>('inbox');
  const [type, setType] = useState<MailType | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reveal, setReveal] = useState<GrantedItem[] | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const pages = useMailboxPages(box);
  const read = useReadMail();
  const claimAll = useClaimAllMail();
  const first = pages.data?.pages[0];
  const view = usePlayerGiftView(first?.names);
  const all = useMemo(() => pages.data?.pages.flatMap((p) => p.messages) ?? [], [pages.data]);
  const counts = useMemo(() => {
    const out = new Map<MailType, number>();
    for (const m of all) out.set(m.type, (out.get(m.type) ?? 0) + 1);
    return out;
  }, [all]);
  const messages = type ? all.filter((m) => m.type === type) : all;
  const current = all.find((m) => m.id === openId) ?? null;
  const unclaimed = first?.unclaimed ?? 0;
  const pick = (m: MailMessage) => {
    setOpenId(m.id);
    if (!m.read) read.mutate(m.id);
  };
  const go = (b: Box) => {
    setBox(b);
    setType(null);
    setOpenId(null);
  };
  const onTabKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const n = (BOXES.indexOf(box) + 1) % BOXES.length;
    go(BOXES[n]!);
    tabs.current[n]?.focus();
  };
  return (
    <Dialog title={t.title} onClose={onClose} className="mailbox">
      <button type="button" className="lip iconbtn modal-close" aria-label={t.close} title={t.close} onClick={onClose}>
        <Icon name="close" />
      </button>
      <div className="mailbox-head">
        <div className="tabs admin-tabs mailbox-boxes" role="tablist" aria-label={t.boxesLabel}>
          {BOXES.map((b, i) => (
            <button
              key={b}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={b === box}
              tabIndex={b === box ? 0 : -1}
              onKeyDown={onTabKey}
              onClick={() => go(b)}
            >
              {t.boxes[b]}
            </button>
          ))}
        </div>
        {box === 'inbox' && unclaimed > 0 ? (
          <button
            type="button"
            className="lip pill pill-solar small mailbox-claim-all"
            disabled={claimAll.isPending}
            aria-busy={claimAll.isPending || undefined}
            onClick={() => claimAll.mutate(undefined, { onSuccess: (r) => setReveal(r.granted.flatMap((x) => x.items)) })}
          >
            <Icon name="starOn" />
            <span>{t.claimAll(unclaimed)}</span>
          </button>
        ) : null}
      </div>
      {pages.error || claimAll.error ? (
        <p className="field-error" role="alert">
          {errorText(pages.error ?? claimAll.error, copy.errors)}
        </p>
      ) : null}
      {pages.data && all.length === 0 ? (
        <p className="mailbox-empty">
          <Icon name="mail" />
          <span>{box === 'inbox' ? t.empty : t.archiveEmpty}</span>
        </p>
      ) : null}
      {all.length > 0 ? (
        <>
          {counts.size > 1 ? (
            <div className="mailbox-types" role="group" aria-label={t.typesLabel}>
              <button type="button" className="mailbox-type" aria-pressed={type === null} aria-label={t.typeFilterOf(t.allTypes, all.length)} onClick={() => setType(null)}>
                <span>{t.allTypes}</span>
                <b>{all.length}</b>
              </button>
              {[...counts].map(([k, n]) => (
                <button key={k} type="button" className={`mailbox-type k-${MAIL_TYPE_LOOK[k].tone}`} aria-pressed={type === k} aria-label={t.typeFilterOf(mailTypeName(k), n)} onClick={() => setType(k)}>
                  <Icon name={MAIL_TYPE_LOOK[k].icon} />
                  <span>{mailTypeName(k)}</span>
                  <b>{n}</b>
                </button>
              ))}
            </div>
          ) : null}
          <div className="mailbox-body">
            <div className="mailbox-side">
              <ul className="mailbox-list" aria-label={t.listLabel}>
                {messages.map((m) => {
                  const look = MAIL_TYPE_LOOK[m.type];
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        className={`mailbox-item k-${look.tone}${m.id === openId ? ' open' : ''}${m.read ? '' : ' unread'}`}
                        aria-current={m.id === openId || undefined}
                        onClick={() => pick(m)}
                      >
                        <span className="mailbox-item-top">
                          <Icon name={look.icon} />
                          <span className="mailbox-item-title">{m.title}</span>
                        </span>
                        <span className="mailbox-item-meta">
                          <time dateTime={m.at}>{day(m.at)}</time>
                          {m.read ? null : <span className="mailbox-new">{t.new}</span>}
                          {hasAnyGift(m.contents) && !m.claimed ? <span className="mailbox-has-gift">{t.hasGift}</span> : null}
                          {m.warn ? <span className="mailbox-warn">{t.warn}</span> : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {messages.length === 0 ? <p className="mailbox-pick">{t.noneOfType}</p> : null}
              {pages.hasNextPage ? (
                <button type="button" className="lip pill small mailbox-more" disabled={pages.isFetchingNextPage} aria-busy={pages.isFetchingNextPage || undefined} onClick={() => void pages.fetchNextPage()}>
                  {t.loadMore}
                </button>
              ) : null}
            </div>
            <div className="mailbox-detail">
              {current ? <Letter key={current.id} m={current} view={view} onReveal={setReveal} onGone={() => setOpenId(null)} onGo={onClose} /> : <p className="mailbox-pick">{t.pick}</p>}
            </div>
          </div>
        </>
      ) : null}
      {reveal ? (
        <GiftReveal
          granted={reveal}
          catalog={view}
          onClose={() => setReveal(null)}
          onLeave={() => {
            setReveal(null);
            onClose();
          }}
        />
      ) : null}
    </Dialog>
  );
}

/** One message (mail v2): its kind's stamp, title, date and text as written; every gift it gives, collected once. */
function Letter({ m, view, onReveal, onGone, onGo }: { m: MailMessage; view: ReturnType<typeof usePlayerGiftView>; onReveal: (items: GrantedItem[]) => void; onGone: () => void; onGo: () => void }) {
  const claim = useClaimMail();
  const archive = useArchiveMail();
  const remove = useDeleteMail();
  // Claimed here: kept even before the mailbox is read again.
  const [taken, setTaken] = useState(false);
  const claimed = m.claimed || taken;
  const gift = hasAnyGift(m.contents);
  const blocked = gift && !claimed;
  const error = claim.error ?? archive.error ?? remove.error;
  return (
    <>
      <LetterView type={m.type} title={m.title} body={m.body} at={m.at} expiresAt={m.expiresAt} contents={m.contents} catalog={view} taken={claimed} link={m.link ?? null} onGo={onGo}>
        {claimed ? (
          <p className="gift-done" role="status">
            <Icon name="check" />
            <span>{t.claimed}</span>
          </p>
        ) : (
          <button
            type="button"
            className="lip pill pill-solar"
            disabled={claim.isPending}
            aria-busy={claim.isPending || undefined}
            onClick={() =>
              claim.mutate(m.id, {
                onSuccess: (r) => {
                  setTaken(true);
                  if (r.granted?.length) onReveal(r.granted);
                },
              })
            }
          >
            {t.claim}
          </button>
        )}
      </LetterView>
      {m.warn && !claimed ? (
        <p className="mailbox-warn-note">
          <Icon name="alert" />
          <span>{t.expires(day(m.expiresAt))}</span>
        </p>
      ) : null}
      <div className="letter-actions">
        <button type="button" className="lip pill small" disabled={archive.isPending} onClick={() => archive.mutate({ id: m.id, archived: !m.archived }, { onSuccess: onGone })}>
          <Icon name={m.archived ? 'back' : 'down'} />
          <span>{m.archived ? t.unarchive : t.archive}</span>
        </button>
        <button type="button" className="lip pill small" disabled={blocked || remove.isPending} aria-describedby={blocked ? `del-${m.id}` : undefined} onClick={() => remove.mutate(m.id, { onSuccess: onGone })}>
          <Icon name="trash" />
          <span>{t.delete}</span>
        </button>
        {blocked ? (
          <small className="letter-actions-note" id={`del-${m.id}`}>
            {t.deleteBlocked}
          </small>
        ) : null}
      </div>
      {error ? (
        <p className="field-error" role="alert">
          {errorText(error, copy.errors)}
        </p>
      ) : null}
    </>
  );
}
