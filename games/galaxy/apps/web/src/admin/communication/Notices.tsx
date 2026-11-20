import type { AdminNoticeRow } from '@galaxy/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { ADMIN_KEY } from '../../api/admin';
import { api } from '../../api/client';
import { useAdminNotices } from '../../api/mail';
import { errorText } from '../../auth/useMe';
import { copy } from '../../copy/es';
import { DateField } from '../../ui/DateField';
import { HScroll } from '../../ui/HScroll';
import { Select } from '../../ui/Select';
import { ActionDialog } from '../ActionDialog';

// The title screen's notices (GDD §16.5; M6d-1): published between two dates, ended early with a reason.

const t = copy.admin.communication;
const when = (iso: string) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
type Open = { url: string; title: string; submit: string } | null;

export function NoticeForm() {
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
        {type === 'datetime-local' ? (
          <DateField id={`${ids}-${k}`} time value={f[k] ?? ''} onChange={(v) => set(k, v)} />
        ) : (
          <input id={`${ids}-${k}`} type={type} autoComplete="off" maxLength={type === 'text' ? 200 : undefined} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
        )}
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

export function NoticeList() {
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
