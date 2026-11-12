import { HScroll } from '../ui/HScroll';
import { type AdminMailRow, type AdminNoticeRow, MAIL_GIFTS, type MailAudience, mailAudienceSchema, type MailGifts } from '@galaxy/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { ADMIN_KEY } from '../api/admin';
import { api } from '../api/client';
import { useAdminMail, useAdminNotices, useMailPreview } from '../api/mail';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { Select } from '../ui/Select';
import { useSettled } from '../ui/useSettled';
import { ActionDialog } from './ActionDialog';

const t = copy.admin.communication;
const when = (iso: string) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const giftLabel = { coins: copy.hub.resource.coins, dust: copy.hub.resource.dust, signal: copy.hub.resource.signal };

type AudienceKind = 'all' | 'names' | 'segment';
type Open = { url: string; title: string; submit: string } | null;

/**
 * The audience the form describes, checked with the server's own schema: null while it is not complete (a list with no
 * names, a segment with nothing), with what to fix when it is wrong (so the form never just keeps counting).
 */
function audienceOf(kind: AudienceKind, f: Record<string, string>): { audience: MailAudience | null; problem?: string } {
  if (kind === 'all') return { audience: { kind: 'all' } };
  if (kind === 'names') {
    const usernames = [...new Set((f['usernames'] ?? '').toLowerCase().split(/[\s,;]+/).filter(Boolean))];
    const bad = usernames.filter((u) => !/^[a-z0-9_]{3,20}$/.test(u));
    if (bad.length) return { audience: null, problem: t.badNames(bad.join(', ')) };
    if (usernames.length === 0) return { audience: null };
    if (usernames.length > 200) return { audience: null, problem: t.usernamesHint };
    return { audience: { kind: 'segment', usernames } };
  }
  const num = (k: string) => (f[k] ? Number(f[k]) : undefined);
  const seg = { kind: 'segment' as const, minLevel: num('minLevel'), maxLevel: num('maxLevel'), joinedFrom: f['joinedFrom'] || undefined, joinedTo: f['joinedTo'] || undefined };
  const clean = Object.fromEntries(Object.entries(seg).filter(([, v]) => v !== undefined));
  if (Object.keys(clean).length <= 1) return { audience: null };
  const parsed = mailAudienceSchema.safeParse(clean);
  return parsed.success ? { audience: parsed.data } : { audience: null, problem: t.audienceInvalid };
}

function audienceText(a: MailAudience): string {
  if (a.kind === 'all') return t.audienceAll;
  const keys = Object.keys(a).filter((k) => k !== 'kind');
  return keys.length === 1 && a.usernames ? t.audienceNames(a.usernames.length) : t.audienceSegment;
}

const giftsText = (g: MailGifts) =>
  MAIL_GIFTS.filter((k) => (g[k] ?? 0) > 0)
    .map((k) => giftLabel[k](g[k]!))
    .join(', ') || t.noGift;

/**
 * Comunicación (GDD §16.5; DESIGN_SYSTEM §8 vicies), admins only: send news with gifts to everyone, a list of accounts
 * or a segment (with how many it reaches before sending, and the password when it gives anything); the sent list with
 * how many read and collected; and the notices of the title screen.
 */
export function CommunicationScreen() {
  return (
    <section className="admin-page comms">
      <h1>{copy.admin.sections.communication}</h1>
      <Compose />
      <SentList />
      <NoticeForm />
      <NoticeList />
    </section>
  );
}

function Compose() {
  const ids = useId();
  const qc = useQueryClient();
  const [f, setF] = useState<Record<string, string>>({ expiresInDays: '30' });
  const [kind, setKind] = useState<AudienceKind>('all');
  const [done, setDone] = useState<number | null>(null);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const { audience, problem } = audienceOf(kind, f);
  const settled = useSettled(audience ? JSON.stringify(audience) : '', 400);
  const preview = useMailPreview(settled ? (JSON.parse(settled) as MailAudience) : null);
  const recipients = settled && settled === JSON.stringify(audience) ? preview.data?.recipients : undefined;
  const gifts = Object.fromEntries(MAIL_GIFTS.filter((k) => Number(f[k] ?? 0) > 0).map((k) => [k, Number(f[k])])) as MailGifts;
  const giving = Object.keys(gifts).length > 0;
  const send = useMutation({
    mutationFn: (body: unknown) => api<{ id: string; recipients: number }>('/admin/mail', { method: 'POST', body }),
    onSuccess: (r) => {
      setDone(r.recipients);
      setF({ expiresInDays: '30' });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ADMIN_KEY }),
  });
  const ready =
    !!audience &&
    recipients !== undefined &&
    (f['title'] ?? '').trim().length > 0 &&
    (f['body'] ?? '').trim().length > 0 &&
    (f['reason'] ?? '').trim().length >= 3 &&
    (!giving || (f['password'] ?? '').length > 0) &&
    !send.isPending;
  const field = (k: string, label: string, opts: { type?: string; hint?: string; numeric?: boolean } = {}) => (
    <div className="field">
      <label htmlFor={`${ids}-${k}`}>{label}</label>
      <div className="control">
        <input
          id={`${ids}-${k}`}
          type={opts.type ?? 'text'}
          inputMode={opts.numeric ? 'numeric' : undefined}
          autoComplete={opts.type === 'password' ? 'current-password' : 'off'}
          value={f[k] ?? ''}
          onChange={(e) => set(k, opts.numeric ? e.target.value.replace(/\D/g, '') : e.target.value)}
        />
      </div>
      {opts.hint ? <p className="hint">{opts.hint}</p> : null}
    </div>
  );
  return (
    <form
      className="lip panel comms-compose"
      aria-label={t.composeTitle}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready || !audience) return;
        setDone(null);
        send.mutate({
          title: f['title']!.trim(),
          body: f['body']!.trim(),
          gifts,
          audience,
          expiresInDays: Number(f['expiresInDays'] || 30),
          reason: f['reason']!.trim(),
          ...(giving ? { password: f['password'] } : {}),
        });
      }}
    >
      <h2>{t.composeTitle}</h2>
      {field('title', t.fields.title)}
      <div className="field">
        <label htmlFor={`${ids}-body`}>{t.fields.body}</label>
        <div className="control">
          <textarea id={`${ids}-body`} rows={5} maxLength={2000} value={f['body'] ?? ''} onChange={(e) => set('body', e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${ids}-audience`}>{t.fields.audience}</label>
        <div className="control">
          <Select<AudienceKind>
            id={`${ids}-audience`}
            size="lg"
            block
            value={kind}
            options={(['all', 'names', 'segment'] as const).map((k) => ({ value: k, label: t.audiences[k] ?? k }))}
            onChange={setKind}
          />
        </div>
      </div>
      {kind === 'names' ? (
        <div className="field">
          <label htmlFor={`${ids}-usernames`}>{t.fields.usernames}</label>
          <div className="control">
            <textarea id={`${ids}-usernames`} rows={3} value={f['usernames'] ?? ''} onChange={(e) => set('usernames', e.target.value)} />
          </div>
          <p className="hint">{t.usernamesHint}</p>
        </div>
      ) : null}
      {kind === 'segment' ? (
        <div className="comms-row">
          {field('minLevel', t.fields.minLevel, { numeric: true })}
          {field('maxLevel', t.fields.maxLevel, { numeric: true })}
          {field('joinedFrom', t.fields.joinedFrom, { type: 'date' })}
          {field('joinedTo', t.fields.joinedTo, { type: 'date' })}
          <p className="hint comms-wide">{t.segmentHint}</p>
        </div>
      ) : null}
      <p className={`comms-reach${problem ? ' bad' : ''}`} aria-live="polite">
        {problem ?? (audience ? (recipients === undefined ? t.counting : t.reach(recipients)) : null)}
      </p>
      <fieldset className="comms-gifts">
        <legend>{t.giftsTitle}</legend>
        <div className="comms-row">{MAIL_GIFTS.map((k) => field(k, t.gifts[k], { numeric: true }))}</div>
        <p className="hint">{t.giftsHint}</p>
      </fieldset>
      <div className="comms-row">
        {field('expiresInDays', t.fields.expires, { numeric: true })}
        {field('reason', copy.admin.fields.reason)}
      </div>
      {giving ? field('password', copy.admin.fields.password, { type: 'password', hint: copy.admin.passwordHint }) : null}
      {send.error ? (
        <p className="field-error" role="alert">
          {errorText(send.error, copy.errors)}
        </p>
      ) : null}
      {done !== null ? (
        <p className="admin-done" role="status">
          {t.sent(done)}
        </p>
      ) : null}
      <button type="submit" className={`lip pill ${giving ? 'danger' : 'pill-solar'}`} disabled={!ready} aria-busy={send.isPending || undefined}>
        {t.send(recipients ?? 0)}
      </button>
    </form>
  );
}

const mailState = (m: AdminMailRow) => (m.withdrawnAt ? 'withdrawn' : new Date(m.expiresAt) <= new Date() ? 'expired' : 'live');

function SentList() {
  const mail = useAdminMail();
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
                {(['title', 'to', 'gifts', 'at', 'recipients', 'read', 'claimed', 'state', 'actions'] as const).map((c) => (
                  <th key={c} scope="col">
                    {t.cols[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const state = mailState(m);
                return (
                  <tr key={m.id}>
                    <td>{m.title}</td>
                    <td>{audienceText(m.audience)}</td>
                    <td>{giftsText(m.gifts)}</td>
                    <td>
                      <time dateTime={m.at}>{when(m.at)}</time>
                    </td>
                    <td>{m.recipients}</td>
                    <td>{m.read}</td>
                    <td>{m.claimed}</td>
                    <td>
                      <span className={`admin-chip${state === 'live' ? ' ok' : ''}`}>{t.mailStates[state]}</span>
                    </td>
                    <td>
                      {state === 'live' ? (
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

function NoticeForm() {
  const ids = useId();
  const qc = useQueryClient();
  const [f, setF] = useState<Record<string, string>>({ tone: 'info' });
  const [done, setDone] = useState(false);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const publish = useMutation({
    mutationFn: (body: unknown) => api<{ id: string }>('/admin/notices', { method: 'POST', body }),
    onSuccess: () => {
      setDone(true);
      setF({ tone: 'info' });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ADMIN_KEY }),
  });
  const starts = f['startsAt'] ? new Date(f['startsAt']) : null;
  const ends = f['endsAt'] ? new Date(f['endsAt']) : null;
  const ready = (f['text'] ?? '').trim().length > 0 && !!starts && !!ends && ends > starts && (f['reason'] ?? '').trim().length >= 3 && !publish.isPending;
  const input = (k: string, label: string, type = 'text') => (
    <div className="field">
      <label htmlFor={`${ids}-${k}`}>{label}</label>
      <div className="control">
        <input id={`${ids}-${k}`} type={type} autoComplete="off" maxLength={type === 'text' ? 200 : undefined} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
      </div>
    </div>
  );
  return (
    <form
      className="lip panel comms-compose"
      aria-label={t.noticeTitle}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready || !starts || !ends) return;
        setDone(false);
        publish.mutate({ text: f['text']!.trim(), tone: f['tone'], startsAt: starts.toISOString(), endsAt: ends.toISOString(), reason: f['reason']!.trim() });
      }}
    >
      <h2>{t.noticeTitle}</h2>
      {input('text', t.fields.noticeText)}
      <div className="comms-row">
        <div className="field">
          <label htmlFor={`${ids}-tone`}>{t.fields.tone}</label>
          <div className="control">
            <Select
              id={`${ids}-tone`}
              size="lg"
              block
              value={f['tone']!}
              options={(['info', 'warning'] as const).map((k) => ({ value: k, label: t.tones[k] }))}
              onChange={(v) => set('tone', v)}
            />
          </div>
        </div>
        {input('startsAt', t.fields.startsAt, 'datetime-local')}
        {input('endsAt', t.fields.endsAt, 'datetime-local')}
      </div>
      {input('reason', copy.admin.fields.reason)}
      {publish.error ? (
        <p className="field-error" role="alert">
          {errorText(publish.error, copy.errors)}
        </p>
      ) : null}
      {done ? (
        <p className="admin-done" role="status">
          {t.noticePublished}
        </p>
      ) : null}
      <button type="submit" className="lip pill pill-solar" disabled={!ready} aria-busy={publish.isPending || undefined}>
        {t.publishNotice}
      </button>
    </form>
  );
}

const noticeState = (n: AdminNoticeRow) => (n.endedAt || new Date(n.endsAt) <= new Date() ? 'ended' : n.live ? 'live' : 'scheduled');

function NoticeList() {
  const notices = useAdminNotices();
  const [open, setOpen] = useState<Open>(null);
  const rows = notices.data ?? [];
  return (
    <div className="comms-block">
      {notices.data && rows.length === 0 ? <p className="panel-note">{t.noNotices}</p> : null}
      {rows.length > 0 ? (
        <HScroll variant="table" className="admin-table-wrap">
          <table className="admin-table">
            <caption>{t.noticesTitle}</caption>
            <thead>
              <tr>
                {(['text', 'tone', 'from', 'to', 'state', 'actions'] as const).map((c) => (
                  <th key={c} scope="col">
                    {t.noticeCols[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((n) => {
                const state = noticeState(n);
                return (
                  <tr key={n.id}>
                    <td>{n.text}</td>
                    <td>{t.tones[n.tone]}</td>
                    <td>
                      <time dateTime={n.startsAt}>{when(n.startsAt)}</time>
                    </td>
                    <td>
                      <time dateTime={n.endsAt}>{when(n.endsAt)}</time>
                    </td>
                    <td>
                      <span className={`admin-chip${state === 'live' ? ' ok' : state === 'scheduled' ? ' staff' : ''}`}>{t.states[state]}</span>
                    </td>
                    <td>
                      {state !== 'ended' ? (
                        <button type="button" className="lip pill small" aria-haspopup="dialog" aria-label={t.endOf(n.text)} onClick={() => setOpen({ url: `/admin/notices/${n.id}/end`, title: t.endOf(n.text), submit: t.end })}>
                          {t.end}
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
