import { HScroll } from '../ui/HScroll';
import { MOD_STATES, type ModMessage, type ModState } from '@galaxy/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { MOD_MESSAGES_KEY, MOD_REPORTS_KEY, type ModFilters, modLiveSeen, NO_FILTERS, useModChannels, useModLive, useModMessages, useModMutes, useModReports } from '../api/moderation';
import { errorText, isAdmin, useMe } from '../auth/useMe';
import { copy } from '../copy/es';
import { DateField } from '../ui/DateField';
import { Icon } from '../ui/Icon';
import { Select } from '../ui/Select';
import { ActionDialog, type FieldSpec } from './ActionDialog';
import { Pager } from './DataTable';

const t = copy.admin.moderation;
const when = (iso: string) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** A change the moderator confirms in a dialog: always a reason, never a password (only dissolving a clan asks it). */
export type ModAction = { title: string; submit: string; url: string; fields?: FieldSpec[]; intro?: ReactNode; password?: boolean; build?: (v: Record<string, string>) => Record<string, unknown> };

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
          intro={open.intro}
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

/** Moderación (DESIGN_SYSTEM §8 octodecies): the report queue, the messages, the mutes and, for admins, the clans. */
export function ModerationLayout() {
  const me = useMe();
  // While it is open the live socket says what is new (messages, reports): nothing here is polled.
  useEffect(() => {
    useModLive.setState({ open: true, fresh: {} });
    return () => useModLive.setState({ open: false, fresh: {} });
  }, []);
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
  if (m.hidden.reason === 'deleted') return t.deleted;
  if (m.hidden.reason === 'reports') return t.hiddenByReports;
  return m.hidden.by ? t.hiddenBy(m.hidden.by) : t.hiddenByStaff;
}

/** A message as moderation shows it: who, where, when, what, and whether it is hidden (in words, not only dimmed). */
function MessageCard({ m, channel, extra, total = true, select, children }: { m: ModMessage; channel?: string; extra?: ReactNode; total?: boolean; select?: ReactNode; children: ReactNode }) {
  const hidden = hiddenText(m);
  const count = total && m.reports > 0;
  return (
    <article className={`mod-message${m.hidden ? ' is-hidden' : ''}${select ? ' selectable' : ''}`} aria-label={t.messageOf(m.author)}>
      {select}
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
      <ReportsLive />
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

/** A new report reads the queue again (the live socket says when; nothing is polled). */
function ReportsLive() {
  const qc = useQueryClient();
  const tick = useModLive((s) => s.reports);
  useEffect(() => {
    if (tick > 0) void qc.invalidateQueries({ queryKey: MOD_REPORTS_KEY });
  }, [tick, qc]);
  return null;
}

const windowField: FieldSpec = { name: 'hours', label: t.window, kind: 'select', options: Object.entries(t.windows) };

/** A field's value a moment after the last key (the search is not read on every key). */
function useSettled<T>(value: T, ms = 350): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/**
 * Every chat's messages (the owner's chat asks, 2026-11-14: «más sencilla y completa, que soporte 100.000 mensajes»):
 * filters for the chat, words in the text, the account, visible or hidden, reported and dates, newest first with
 * «Ver anteriores»; an account's history with what can be done to it; picking several to hide at once; and on each
 * message hide or restore, hide and mute, mute, delete (never undone) and its author's history. The live socket says
 * how many new messages came to what is shown; «Ver» reads them.
 */
export function LiveChat() {
  const ids = useId();
  const me = useMe();
  const qc = useQueryClient();
  const channels = useModChannels();
  const [f, setF] = useState<ModFilters>(NO_FILTERS);
  const set = (patch: Partial<ModFilters>) => setF((x) => ({ ...x, ...patch }));
  const q = useSettled(f.q);
  const author = useSettled(f.author);
  const search: ModFilters = { ...f, q, author };
  const messages = useModMessages(search);
  const dialog = useModDialog();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const freshMap = useModLive((s) => s.fresh);
  const fresh = search.channel === 'all' ? Object.values(freshMap).reduce((a, n) => a + n, 0) : (freshMap[search.channel] ?? 0);
  const rows = messages.data?.pages.flat() ?? [];
  const options = [{ value: 'all', label: t.search.allChannels }, ...(channels.data ?? [{ key: 'global', label: copy.hub.community, lastAt: null }]).map((c) => ({ value: c.key, label: c.label }))];
  const filtered = JSON.stringify(f) !== JSON.stringify(NO_FILTERS);
  const history = search.author.trim() ? search.author.trim().toLowerCase() : null;
  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else if (next.size < 100) next.add(id);
      return next;
    });
  const reread = () => {
    modLiveSeen();
    void qc.resetQueries({ queryKey: MOD_MESSAGES_KEY });
  };
  return (
    <div className="mod-pane">
      <form className="mod-filters" role="search" aria-label={t.search.title} onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label id={`${ids}-channel`}>{t.channel}</label>
          <div className="control">
            <Select aria-labelledby={`${ids}-channel`} block value={f.channel} options={options} onChange={(channel) => set({ channel })} />
          </div>
        </div>
        <div className="field">
          <label htmlFor={`${ids}-q`}>{t.search.text}</label>
          <div className="control">
            <input id={`${ids}-q`} type="search" autoComplete="off" maxLength={100} value={f.q} aria-describedby={`${ids}-q-hint`} onChange={(e) => set({ q: e.target.value })} />
          </div>
          <p className="hint" id={`${ids}-q-hint`}>
            {t.search.textHint}
          </p>
        </div>
        <div className="field">
          <label htmlFor={`${ids}-author`}>{t.search.author}</label>
          <div className="control">
            <input id={`${ids}-author`} type="search" autoComplete="off" maxLength={20} value={f.author} onChange={(e) => set({ author: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label id={`${ids}-state`}>{t.search.state}</label>
          <div className="control">
            <Select<ModState> aria-labelledby={`${ids}-state`} block value={f.state} options={MOD_STATES.map((k) => ({ value: k, label: t.search.states[k] }))} onChange={(state) => set({ state })} />
          </div>
        </div>
        {(['from', 'to'] as const).map((k) => (
          <div className="field" key={k}>
            <label htmlFor={`${ids}-${k}`}>{t.search[k]}</label>
            <div className="control">
              <DateField id={`${ids}-${k}`} time value={f[k]} onChange={(v) => set({ [k]: v })} />
            </div>
          </div>
        ))}
        <label className="admin-check mod-reported">
          <input type="checkbox" checked={f.reported} onChange={(e) => set({ reported: e.target.checked })} />
          <span>{t.search.reported}</span>
        </label>
        <div className="mod-filters-tools">
          {filtered ? (
            <button type="button" className="lip pill small" onClick={() => setF(NO_FILTERS)}>
              {t.search.clear}
            </button>
          ) : null}
          {isAdmin(me.data) ? (
            <Link to="/admin/configuracion/chat" className="mod-words">
              {t.words}
            </Link>
          ) : null}
        </div>
      </form>
      {dialog.view}
      {history ? (
        <div className="mod-history" role="group" aria-label={t.historyTitle(history)}>
          <h2>{t.historyTitle(history)}</h2>
          <button type="button" className="lip pill small danger" aria-haspopup="dialog" onClick={() => dialog.start({ title: t.hideRecentOf(history), submit: t.hideRecent, url: `/admin/moderation/authors/${encodeURIComponent(history)}/hide`, fields: [windowField], build: (v) => ({ hours: Number(v['hours']) }) })}>
            {t.hideRecent}
          </button>
          <button type="button" className="lip pill small" aria-haspopup="dialog" onClick={() => dialog.start(muteOf(history))}>
            {t.muteOf(history)}
          </button>
          <button type="button" className="lip pill small" onClick={() => set({ author: '' })}>
            {t.historyBack}
          </button>
        </div>
      ) : null}
      {fresh > 0 ? (
        <p className="mod-fresh" role="status">
          <span>{t.search.fresh(fresh)}</span>
          <button type="button" className="lip pill small pill-solar" onClick={reread}>
            {t.search.freshSee}
          </button>
        </p>
      ) : null}
      {picked.size > 0 ? (
        <div className="mod-selection" role="group" aria-label={t.selected(picked.size)}>
          <b>{t.selected(picked.size)}</b>
          <button
            type="button"
            className="lip pill small danger"
            aria-haspopup="dialog"
            onClick={() =>
              dialog.start({
                title: t.hideSelected(picked.size),
                submit: t.hide,
                url: '/admin/moderation/messages/hide',
                build: () => {
                  const ids = [...picked];
                  setPicked(new Set());
                  return { ids };
                },
              })
            }
          >
            {t.hideSelected(picked.size)}
          </button>
          <button type="button" className="lip pill small" onClick={() => setPicked(new Set())}>
            {t.unselect}
          </button>
        </div>
      ) : null}
      {messages.error ? (
        <p className="field-error" role="alert">
          {errorText(messages.error, copy.errors)}
        </p>
      ) : null}
      {messages.data && rows.length === 0 ? <p className="panel-note">{filtered ? t.search.none : t.noMessages}</p> : null}
      {rows.length > 0 ? <p className="mod-count">{t.search.count(rows.length, !!messages.hasNextPage)}</p> : null}
      <div className="mod-list">
        {rows.map((m) => {
          const deleted = m.hidden?.reason === 'deleted';
          const toggleUrl = `/admin/moderation/messages/${m.id}/${m.hidden ? 'restore' : 'hide'}`;
          const title = m.hidden ? t.restore : t.hide;
          return (
            <MessageCard
              key={m.id}
              m={m}
              channel={search.channel === 'all' ? labelOf(channels.data, m.channel) : undefined}
              select={
                m.hidden ? undefined : (
                  <label className="mod-pick">
                    <input type="checkbox" checked={picked.has(m.id)} disabled={!picked.has(m.id) && picked.size >= 100} onChange={() => toggle(m.id)} aria-label={t.select(m.author)} />
                  </label>
                )
              }
            >
              {deleted ? null : (
                <button type="button" className={`lip pill small${m.hidden ? '' : ' danger'}`} aria-haspopup="dialog" onClick={() => dialog.start({ title, submit: title, url: toggleUrl })}>
                  {title}
                </button>
              )}
              {m.hidden ? null : (
                <button
                  type="button"
                  className="lip pill small danger"
                  aria-haspopup="dialog"
                  aria-label={t.hideMuteOf(m.author)}
                  onClick={() => dialog.start({ title: t.hideMuteOf(m.author), submit: t.hideMute, url: `/admin/moderation/messages/${m.id}/hide-mute`, fields: [durationField], build: (v) => ({ minutes: Number(v['minutes']) }) })}
                >
                  {t.hideMute}
                </button>
              )}
              {deleted ? null : (
                <button
                  type="button"
                  className="lip pill small"
                  aria-haspopup="dialog"
                  aria-label={t.deleteOf(m.author)}
                  onClick={() => dialog.start({ title: t.deleteOf(m.author), submit: t.delete, url: `/admin/moderation/messages/${m.id}/delete`, intro: <p className="panel-note">{t.deleteHint}</p> })}
                >
                  {t.delete}
                </button>
              )}
              {history === m.author ? null : (
                <button type="button" className="lip pill small" aria-label={t.historyOf(m.author)} onClick={() => set({ author: m.author, channel: 'all' })}>
                  <Icon name="list" />
                  <span>{t.history}</span>
                </button>
              )}
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

/** A chat's name in the list (Comunidad, a clan's tag and name, a room's). */
function labelOf(channels: { key: string; label: string }[] | undefined, key: string): string {
  return channels?.find((c) => c.key === key)?.label ?? (key === 'global' ? copy.hub.community : key.startsWith('room:') ? t.roomChannel : t.clanChannel);
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
