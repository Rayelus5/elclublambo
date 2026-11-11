import { HScroll } from '../ui/HScroll';
import type { ModMessage } from '@galaxy/shared';
import { type ReactNode, useId, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { useModChannels, useModMessages, useModMutes, useModReports } from '../api/moderation';
import { errorText, isAdmin, useMe } from '../auth/useMe';
import { copy } from '../copy/es';
import { ActionDialog, type FieldSpec } from './ActionDialog';
import { Pager } from './DataTable';

const t = copy.admin.moderation;
const when = (iso: string) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** A change the moderator confirms in a dialog: always a reason, never a password (only dissolving a clan asks it). */
export type ModAction = { title: string; submit: string; url: string; fields?: FieldSpec[]; password?: boolean; build?: (v: Record<string, string>) => Record<string, unknown> };

const durationField: FieldSpec = { name: 'minutes', label: copy.admin.fields.duration, kind: 'select', options: Object.entries(t.durations) };

/** Muting `username` from a message or the mutes list. */
const muteOf = (username: string): ModAction => ({
  title: t.muteOf(username),
  submit: t.muteSubmit,
  url: '/admin/moderation/mutes',
  fields: [durationField],
  build: (v) => ({ username, minutes: Number(v['minutes']) }),
});

/** The dialog of the action open, if any, and «Hecho» once one is done. */
export function useModDialog() {
  const [open, setOpen] = useState<ModAction | null>(null);
  const [done, setDone] = useState(false);
  const start = (a: ModAction) => {
    setDone(false);
    setOpen(a);
  };
  const view = (
    <>
      {done ? (
        <p className="admin-done" role="status">
          {copy.admin.done}
        </p>
      ) : null}
      {open ? (
        <ActionDialog
          url={open.url}
          title={open.title}
          submit={open.submit}
          fields={open.fields}
          password={() => !!open.password}
          build={open.build}
          onDone={() => {
            setOpen(null);
            setDone(true);
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
  return { start, view, setOpen };
}

/** Moderación (DESIGN_SYSTEM §8 octodecies): the report queue, the live chat, the mutes and, for admins, the clans. */
export function ModerationLayout() {
  const me = useMe();
  return (
    <section className="admin-page">
      <h1>{copy.admin.sections.moderation}</h1>
      <nav aria-label={t.nav} className="admin-subnav">
        <NavLink to="/admin/moderacion" end>
          {t.tabs.reports}
        </NavLink>
        <NavLink to="/admin/moderacion/jugadores">{t.tabs.players}</NavLink>
        <NavLink to="/admin/moderacion/chat">{t.tabs.live}</NavLink>
        <NavLink to="/admin/moderacion/silencios">{t.tabs.mutes}</NavLink>
        <NavLink to="/admin/moderacion/salas">{t.tabs.rooms}</NavLink>
        {isAdmin(me.data) ? (
          <>
            <NavLink to="/admin/moderacion/clanes">{t.tabs.clans}</NavLink>
            <NavLink to="/admin/moderacion/comercio">{t.tabs.commerce}</NavLink>
            <NavLink to="/admin/moderacion/alertas">{t.tabs.alerts}</NavLink>
          </>
        ) : null}
      </nav>
      <Outlet />
    </section>
  );
}

/** A channel's name: the global chat, or a clan's tag and name (the live view's list of channels). */
function useChannelLabel(): (key: string) => string {
  const channels = useModChannels();
  return (key) => channels.data?.find((c) => c.key === key)?.label ?? (key === 'global' ? copy.hub.community : key.startsWith('room:') ? t.roomChannel : t.clanChannel);
}

function hiddenText(m: ModMessage): string | null {
  if (!m.hidden) return null;
  if (m.hidden.reason === 'reports') return t.hiddenByReports;
  return m.hidden.by ? t.hiddenBy(m.hidden.by) : t.hiddenByStaff;
}

/** A message as moderation shows it: who, where, when, what, and whether it is hidden (in words, not only dimmed). */
function MessageCard({ m, channel, extra, total = true, children }: { m: ModMessage; channel?: string; extra?: ReactNode; total?: boolean; children: ReactNode }) {
  const hidden = hiddenText(m);
  const count = total && m.reports > 0;
  return (
    <article className={`mod-message${m.hidden ? ' is-hidden' : ''}`} aria-label={t.messageOf(m.author)}>
      <header>
        <b>{m.author}</b>
        {channel ? <span className="mod-channel">{channel}</span> : null}
        <time dateTime={m.at}>{when(m.at)}</time>
      </header>
      <p className="mod-body">{m.body}</p>
      {hidden || count ? (
        <p className="admin-chips">
          {hidden ? <span className="admin-chip bad">{hidden}</span> : null}
          {count ? <span className="admin-chip warn">{t.reports(m.reports)}</span> : null}
        </p>
      ) : null}
      {extra}
      <div className="admin-actions">{children}</div>
    </article>
  );
}

/** The report queue: the message reported most recently first, 50 a page; each one is hidden or kept visible with a reason. */
export function Reports() {
  const [page, setPage] = useState(1);
  const reports = useModReports(page);
  const label = useChannelLabel();
  const dialog = useModDialog();
  const rows = reports.data?.reports ?? [];
  // Resolving the last card of the last page leaves that page past the end: go back to the last one there is (state
  // adjusted while rendering, as React recommends over an effect).
  if (reports.data && page > reports.data.pages) setPage(reports.data.pages);
  return (
    <div className="mod-pane">
      {dialog.view}
      {reports.error ? (
        <p className="field-error" role="alert">
          {errorText(reports.error, copy.errors)}
        </p>
      ) : null}
      {reports.data && reports.data.total === 0 ? <p className="panel-note">{t.noReports}</p> : null}
      {reports.data && reports.data.total > 0 ? <p className="mod-waiting">{t.waiting(reports.data.total)}</p> : null}
      <div className="mod-list">
        {rows.map((r) => {
          const m = r.message;
          const url = `/admin/moderation/reports/${m.id}`;
          const hide: ModAction = { title: m.hidden ? t.keepHidden : t.hide, submit: m.hidden ? t.keepHidden : t.hide, url, build: () => ({ outcome: 'hidden' }) };
          const keep: ModAction = { title: m.hidden ? t.restore : t.keep, submit: m.hidden ? t.restore : t.keep, url, build: () => ({ outcome: 'kept' }) };
          return (
            <MessageCard
              key={m.id}
              m={m}
              channel={label(m.channel)}
              // The total adds something only when some reports were already reviewed.
              total={m.reports !== r.pending}
              extra={
                <div className="mod-report">
                  <p className="mod-pending">{t.pending(r.pending)}</p>
                  {r.reasons.length ? (
                    <ul aria-label={t.reasonsTitle}>
                      {r.reasons.map((reason, i) => (
                        <li key={i}>{reason}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              }
            >
              <button type="button" className="lip pill small danger" aria-haspopup="dialog" onClick={() => dialog.start(hide)}>
                {hide.title}
              </button>
              <button type="button" className="lip pill small" aria-haspopup="dialog" onClick={() => dialog.start(keep)}>
                {keep.title}
              </button>
              <button type="button" className="lip pill small" aria-haspopup="dialog" onClick={() => dialog.start(muteOf(m.author))}>
                {t.muteOf(m.author)}
              </button>
            </MessageCard>
          );
        })}
      </div>
      {reports.data ? <Pager page={reports.data.page} pages={reports.data.pages} onPage={setPage} /> : null}
    </div>
  );
}

/** Every chat live: a channel at a time, newest first, read again every 5 s unless paused; hidden ones included. */
export function LiveChat() {
  const id = useId();
  const me = useMe();
  const channels = useModChannels();
  const [channel, setChannel] = useState('global');
  const [live, setLive] = useState(true);
  const messages = useModMessages(channel, live);
  const dialog = useModDialog();
  const rows = messages.data?.pages.flat() ?? [];
  const options = channels.data ?? [{ key: 'global', label: copy.hub.community, lastAt: null }];
  return (
    <div className="mod-pane">
      <div className="mod-toolbar">
        <div className="field">
          <label htmlFor={id}>{t.channel}</label>
          <div className="control">
            <select id={id} value={channel} onChange={(e) => setChannel(e.target.value)}>
              {options.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className={`mod-live${live ? ' on' : ''}`}>{live ? t.live : t.paused}</p>
        <button type="button" className="lip pill small" aria-pressed={!live} onClick={() => setLive((v) => !v)}>
          {live ? t.pause : t.resume}
        </button>
        {isAdmin(me.data) ? (
          <Link to="/admin/configuracion/chat" className="mod-words">
            {t.words}
          </Link>
        ) : null}
      </div>
      {dialog.view}
      {messages.error ? (
        <p className="field-error" role="alert">
          {errorText(messages.error, copy.errors)}
        </p>
      ) : null}
      {messages.data && rows.length === 0 ? <p className="panel-note">{t.noMessages}</p> : null}
      <div className="mod-list">
        {rows.map((m) => {
          const url = `/admin/moderation/messages/${m.id}/${m.hidden ? 'restore' : 'hide'}`;
          const title = m.hidden ? t.restore : t.hide;
          return (
            <MessageCard key={m.id} m={m}>
              <button type="button" className={`lip pill small${m.hidden ? '' : ' danger'}`} aria-haspopup="dialog" onClick={() => dialog.start({ title, submit: title, url })}>
                {title}
              </button>
              <button type="button" className="lip pill small" aria-haspopup="dialog" onClick={() => dialog.start(muteOf(m.author))}>
                {t.muteOf(m.author)}
              </button>
            </MessageCard>
          );
        })}
      </div>
      {messages.hasNextPage ? (
        <button type="button" className="lip pill small mod-older" disabled={messages.isFetchingNextPage} onClick={() => void messages.fetchNextPage()}>
          {t.older}
        </button>
      ) : null}
    </div>
  );
}

/** The mutes running now, each lifted with a reason; and muting any account by name. */
export function Mutes() {
  const mutes = useModMutes();
  const dialog = useModDialog();
  const rows = mutes.data ?? [];
  const mute: ModAction = {
    title: t.mute,
    submit: t.muteSubmit,
    url: '/admin/moderation/mutes',
    fields: [{ name: 'username', label: t.username, kind: 'text' }, durationField],
    build: (v) => ({ username: v['username']?.trim(), minutes: Number(v['minutes']) }),
  };
  return (
    <div className="mod-pane">
      <div className="admin-actions">
        <button type="button" className="lip pill small pill-solar" aria-haspopup="dialog" onClick={() => dialog.start(mute)}>
          {t.mute}
        </button>
      </div>
      {dialog.view}
      {mutes.error ? (
        <p className="field-error" role="alert">
          {errorText(mutes.error, copy.errors)}
        </p>
      ) : null}
      {mutes.data && rows.length === 0 ? <p className="panel-note">{t.noMutes}</p> : null}
      {rows.length > 0 ? (
        <HScroll variant="table" className="admin-table-wrap">
          <table className="admin-table">
            <caption>{t.mutesTitle}</caption>
            <thead>
              <tr>
                {(['username', 'until', 'reason', 'by', 'actions'] as const).map((c) => (
                  <th key={c} scope="col">
                    {t.cols[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.username}>
                  <td>{m.username}</td>
                  <td>
                    <time dateTime={m.until}>{when(m.until)}</time>
                  </td>
                  <td>{m.reason}</td>
                  <td>{m.by ?? '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="lip pill small"
                      aria-haspopup="dialog"
                      aria-label={t.liftOf(m.username)}
                      onClick={() => dialog.start({ title: t.liftOf(m.username), submit: t.lift, url: `/admin/moderation/mutes/${encodeURIComponent(m.username)}/lift` })}
                    >
                      {t.lift}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </HScroll>
      ) : null}
    </div>
  );
}
