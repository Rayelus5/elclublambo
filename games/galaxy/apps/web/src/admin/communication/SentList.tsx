import { type AdminMailRow, allGifts } from '@galaxy/shared';
import type { ComposeSeed } from './Compose';
import { useState } from 'react';
import { useAdminMail } from '../../api/mail';
import { copy } from '../../copy/es';
import { GiftArt } from '../../gifts/GiftArt';
import { useGiftCatalog } from '../../gifts/useGiftCatalog';
import { giftWords } from '../../gifts/words';
import { MAIL_TYPE_LOOK, mailTypeName } from '../../mail/types';
import { HScroll } from '../../ui/HScroll';
import { Icon } from '../../ui/Icon';
import { ActionDialog } from '../ActionDialog';
import { audienceText } from './audience';

// The messages sent (GDD §16.5; mail v2, P3): each with its kind, who it went to, its gifts drawn, how many it reached,
// read and collected, and whether it is still in the mailboxes (withdrawn with a reason while it is).

const t = copy.admin.communication;
const when = (iso: string) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
type Open = { url: string; title: string; submit: string } | null;
const mailState = (m: AdminMailRow) => (m.withdrawnAt ? 'withdrawn' : !m.sentAt ? 'scheduled' : new Date(m.expiresAt) <= new Date() ? 'expired' : 'live');
const ADMIN_TYPES = ['announcement', 'gift', 'compensation', 'event', 'reward', 'personal'] as const;

/** A sent message as the form's starting point (its library packs that still exist go by name). */
function seedOf(m: AdminMailRow): ComposeSeed {
  const days = Math.round((Date.parse(m.expiresAt) - Date.parse(m.at)) / 86_400_000);
  return {
    type: (ADMIN_TYPES as readonly string[]).includes(m.type) ? (m.type as ComposeSeed['type']) : 'announcement',
    title: m.title,
    body: m.body,
    items: m.contents.items,
    packs: m.contents.packs.map((p) => p.id),
    expiresInDays: Math.max(1, Math.min(365, days || 30)),
  };
}

export function SentList({ onDuplicate }: { onDuplicate?: (seed: ComposeSeed) => void }) {
  const mail = useAdminMail();
  const { catalog } = useGiftCatalog();
  const [open, setOpen] = useState<Open>(null);
  const rows = mail.data ?? [];
  return (
    <div className="comms-block">
      {mail.data && rows.length === 0 ? <p className="panel-note">{t.noSent}</p> : null}
      {rows.length > 0 ? (
        <HScroll variant="table" className="admin-table-wrap">
          <table className="admin-table">
            <caption>{t.sentTitle}</caption>
            <thead>
              <tr>
                {(['title', 'type', 'to', 'gifts', 'at', 'recipients', 'read', 'claimed', 'state', 'actions'] as const).map((c) => (
                  <th key={c} scope="col">
                    {t.cols[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const state = mailState(m);
                const gifts = allGifts(m.contents);
                const look = MAIL_TYPE_LOOK[m.type];
                const words = catalog ? gifts.map((x) => giftWords(x, catalog)).join(', ') : '';
                return (
                  <tr key={m.id}>
                    <td>{m.title}</td>
                    <td>
                      <span className={`mail-type-chip k-${look.tone}`}>
                        <Icon name={look.icon} />
                        <span>{mailTypeName(m.type)}</span>
                      </span>
                    </td>
                    <td>{audienceText(m.audience)}</td>
                    <td>
                      {gifts.length === 0 ? (
                        t.noGift
                      ) : (
                        <span className="comms-gift-strip" title={words || undefined}>
                          {catalog ? gifts.slice(0, 6).map((x, i) => <GiftArt key={i} gift={x} catalog={catalog} compact />) : null}
                          {gifts.length > 6 ? <small aria-hidden="true">+{gifts.length - 6}</small> : null}
                          <span className="sr-only">{words}</span>
                          {m.big ? <span className="admin-chip staff">{t.big}</span> : null}
                        </span>
                      )}
                    </td>
                    <td>
                      <time dateTime={m.at}>{when(m.at)}</time>
                    </td>
                    <td>{m.recipients}</td>
                    <td>
                      <Meter value={m.read} of={m.recipients} />
                    </td>
                    <td>
                      <Meter value={m.claimed} of={m.recipients} />
                      {m.outcomes.owned + m.outcomes.skipped > 0 ? (
                        <small className="comms-outcomes">
                          {m.outcomes.owned > 0 ? <span>{t.outcomes.owned(m.outcomes.owned)}</span> : null}
                          {m.outcomes.skipped > 0 ? <span className="bad">{t.outcomes.skipped(m.outcomes.skipped)}</span> : null}
                        </small>
                      ) : null}
                    </td>
                    <td>
                      <span className={`admin-chip${state === 'live' ? ' ok' : state === 'scheduled' ? ' staff' : ''}`}>{t.mailStates[state]}</span>
                      {state === 'scheduled' && m.scheduledAt ? (
                        <small className="comms-when">
                          <time dateTime={m.scheduledAt}>{when(m.scheduledAt)}</time>
                        </small>
                      ) : null}
                    </td>
                    <td className="comms-actions">
                      {onDuplicate ? (
                        <button type="button" className="lip pill small" aria-label={t.duplicateOf(m.title)} onClick={() => onDuplicate(seedOf(m))}>
                          {t.duplicate}
                        </button>
                      ) : null}
                      {state === 'live' || state === 'scheduled' ? (
                        <button
                          type="button"
                          className="lip pill small"
                          aria-haspopup="dialog"
                          aria-label={t.withdrawOf(m.title)}
                          onClick={() => setOpen({ url: `/admin/mail/${m.id}/withdraw`, title: t.withdrawOf(m.title), submit: t.withdraw })}
                        >
                          {t.withdraw}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </HScroll>
      ) : null}
      {open ? <ActionDialog url={open.url} title={open.title} submit={open.submit} password={() => false} onDone={() => setOpen(null)} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

/** A share of the recipients as a short bar and its numbers. */
function Meter({ value, of }: { value: number; of: number }) {
  const p = of > 0 ? Math.round((value / of) * 100) : 0;
  return (
    <span className="comms-meter">
      <span className="comms-meter-bar" aria-hidden="true">
        <span style={{ inlineSize: `${p}%` }} />
      </span>
      <span>{t.readOf(value, of)}</span>
    </span>
  );
}
