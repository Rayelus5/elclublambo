import type { FriendEntry, FriendsView, InvitePolicy, Presence } from '@galaxy/shared';
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { useFriendAction, useFriends, useSocialPrefs } from '../api/friends';
import { errorText, useMe } from '../auth/useMe';
import { copy } from '../copy/es';
import { useUi } from '../state/ui';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { Avatar } from '../hub/Avatar';

// Friends (multiplayer plan, phase 3): a side sheet like the chat's, that never blocks the game. Friends first (the
// online ones on top, with what they are doing), requests both ways, whom I blocked, and my privacy. Adding is by
// username here or from a profile. Removing and blocking ask first; a block is never told to the one blocked.

const t = copy.friends;
type Tab = 'friends' | 'requests' | 'blocked' | 'privacy';
const TABS: Tab[] = ['friends', 'requests', 'blocked', 'privacy'];

export function presenceText(p: Presence): string {
  if (p.status === 'offline') return t.presence.offline;
  if (p.activity === 'room') return p.room ? t.presence.room(p.room.size, p.room.max) : t.presence.hub;
  if (p.activity === 'run') return t.presence.run(p.layer);
  return t.presence[p.activity];
}

export function FriendsHost() {
  const me = useMe().data;
  const open = useUi((s) => s.friends);
  const close = useUi((s) => s.closeFriends);
  useEffect(() => {
    if (!me && open) close();
  }, [me, open, close]);
  return me && open ? <FriendsPanel onClose={close} /> : null;
}

type Pending = { kind: 'remove' | 'block'; username: string } | null;

function FriendsPanel({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const panelId = useId();
  const sheet = useRef<HTMLDivElement>(null);
  const friends = useFriends();
  const [tab, setTab] = useState<Tab>(() => ((friends.data?.incoming.length ?? 0) > 0 ? 'requests' : 'friends'));
  const action = useFriendAction();
  const [pending, setPending] = useState<Pending>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const v = friends.data;

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheet.current?.focus();
    return () => before?.focus();
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== 'Escape' || pending) return;
    e.stopPropagation();
    onClose();
  }

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>): void {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!;
    setTab(next);
    sheet.current?.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
  }

  function act(username: string, kind: 'accept' | 'remove' | 'block' | 'unblock', done?: string): void {
    setNotice(null);
    action.mutate({ username, action: kind }, { onSuccess: () => done && setNotice(done) });
  }

  const online = v?.friends.filter((f) => f.presence.status === 'online').length ?? 0;
  return createPortal(
    <div ref={sheet} role="dialog" aria-labelledby={titleId} tabIndex={-1} className="lip panel chat-sheet friends-sheet" onKeyDown={onKeyDown}>
      <header className="chat-top">
        <h2 id={titleId}>{t.title}</h2>
        <span className="chat-status" role="status">
          {notice ?? (v ? t.online(online) : '')}
        </span>
        <button type="button" className="lip iconbtn small" aria-label={t.close} title={t.close} onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <div className="tabs chat-tabs friends-tabs" role="tablist" aria-label={t.tabsLabel}>
        {TABS.map((k) => (
          <button key={k} type="button" role="tab" data-tab={k} aria-selected={k === tab} aria-controls={panelId} tabIndex={k === tab ? 0 : -1} onClick={() => setTab(k)} onKeyDown={onTabKey}>
            {t.tabs[k]}
            {k === 'requests' && (v?.incoming.length ?? 0) > 0 ? <span className="friends-count">{v!.incoming.length}</span> : null}
          </button>
        ))}
      </div>
      <div id={panelId} role="tabpanel" aria-label={t.tabs[tab]} className="friends-body">
        {action.isError ? (
          <p className="summary error" role="alert">
            <Icon name="alert" />
            <span>{errorText(action.error, copy.errors)}</span>
          </p>
        ) : null}
        {!v ? (
          friends.isError ? (
            <p className="summary error" role="alert">
              <Icon name="alert" />
              <span>{errorText(friends.error, copy.errors)}</span>
            </p>
          ) : (
            <p className="friends-empty" aria-hidden="true">
              ⠋⠙⠹
            </p>
          )
        ) : tab === 'friends' ? (
          <FriendsTab v={v} onAsk={(kind, username) => setPending({ kind, username })} onNotice={setNotice} />
        ) : tab === 'requests' ? (
          <RequestsTab v={v} onAct={act} busy={action.isPending} />
        ) : tab === 'blocked' ? (
          <BlockedTab v={v} onAct={act} busy={action.isPending} />
        ) : (
          <PrivacyTab v={v} onNotice={setNotice} />
        )}
      </div>
      {pending ? (
        <Dialog role="alertdialog" title={pending.kind === 'remove' ? t.removeTitle(pending.username) : t.blockTitle(pending.username)} onClose={() => setPending(null)} className="confirm">
          <p>{pending.kind === 'remove' ? t.removeBody : t.blockBody}</p>
          <div className="confirm-actions">
            <button type="button" className="lip pill" data-autofocus onClick={() => setPending(null)}>
              {t.keep}
            </button>
            <button
              type="button"
              className="lip pill danger"
              onClick={() => {
                act(pending.username, pending.kind);
                setPending(null);
              }}
            >
              {pending.kind === 'remove' ? t.remove : t.block}
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>,
    document.body,
  );
}

function AddFriend({ onNotice }: { onNotice: (s: string) => void }) {
  const [name, setName] = useState('');
  const action = useFriendAction();
  const id = useId();
  function submit(e: FormEvent): void {
    e.preventDefault();
    const username = name.trim();
    if (!username) return;
    action.mutate(
      { username, action: 'request' },
      {
        onSuccess: (view: FriendsView) => {
          setName('');
          onNotice(view.friends.some((f) => f.username === username.toLowerCase()) ? t.nowFriends(username) : t.sent(username));
        },
      },
    );
  }
  return (
    <form className="friends-add" onSubmit={submit}>
      <label htmlFor={id}>{t.addLabel}</label>
      <div>
        <input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder={t.addPlaceholder} autoComplete="off" spellCheck={false} maxLength={20} />
        <button type="submit" className="lip pill pill-solar small" disabled={!name.trim() || action.isPending}>
          <Icon name="plus" />
          <span>{t.send}</span>
        </button>
      </div>
      {action.isError ? (
        <p className="field-error" role="alert">
          {errorText(action.error, copy.errors)}
        </p>
      ) : null}
    </form>
  );
}

function FriendRow({ f, onAsk }: { f: FriendEntry; onAsk: (kind: 'remove' | 'block', username: string) => void }) {
  const on = f.presence.status === 'online';
  return (
    <li className={on ? 'friend on' : 'friend'}>
      <span className="friend-face">
        <Avatar name={f.username} avatar={f.avatar} frame={f.frame} />
        <span className="friend-dot" aria-hidden="true" />
      </span>
      <div className="friend-main">
        <Link to={`/perfil/${encodeURIComponent(f.username)}`} className="friend-name">
          {f.username}
        </Link>
        <span className="friend-meta">
          {copy.social.level(f.level)}
          {f.clan ? ` · [${f.clan}]` : ''}
        </span>
        <span className="friend-status">{presenceText(f.presence)}</span>
      </div>
      <div className="friend-actions" role="group" aria-label={t.actionsFor(f.username)}>
        <button type="button" className="lip iconbtn small" aria-label={`${t.remove} ${f.username}`} title={t.remove} onClick={() => onAsk('remove', f.username)}>
          <Icon name="trash" />
        </button>
        <button type="button" className="lip iconbtn small" aria-label={`${t.block} ${f.username}`} title={t.block} onClick={() => onAsk('block', f.username)}>
          <Icon name="lock" />
        </button>
      </div>
    </li>
  );
}

function FriendsTab({ v, onAsk, onNotice }: { v: FriendsView; onAsk: (kind: 'remove' | 'block', username: string) => void; onNotice: (s: string) => void }) {
  return (
    <>
      <AddFriend onNotice={onNotice} />
      <p className="friends-cap">{t.count(v.friends.length, v.max)}</p>
      {v.friends.length === 0 ? (
        <p className="friends-empty">{t.empty}</p>
      ) : (
        <ul className="friends-list">
          {[...v.friends]
            .sort((x, y) => Number(y.presence.status === 'online') - Number(x.presence.status === 'online') || x.username.localeCompare(y.username))
            .map((f) => (
              <FriendRow key={f.username} f={f} onAsk={onAsk} />
            ))}
        </ul>
      )}
    </>
  );
}

function RequestsTab({ v, onAct, busy }: { v: FriendsView; onAct: (u: string, k: 'accept' | 'remove', done?: string) => void; busy: boolean }) {
  if (v.incoming.length === 0 && v.outgoing.length === 0) return <p className="friends-empty">{t.noRequests}</p>;
  return (
    <>
      {v.incoming.length > 0 ? (
        <section aria-label={t.incoming}>
          <h3>{t.incoming}</h3>
          <ul className="friends-list">
            {v.incoming.map((r) => (
              <li key={r.username} className="friend">
                <div className="friend-main">
                  <Link to={`/perfil/${encodeURIComponent(r.username)}`} className="friend-name">
                    {r.username}
                  </Link>
                  <span className="friend-meta">{copy.social.level(r.level)}</span>
                </div>
                <div className="friend-actions">
                  <button type="button" className="lip pill pill-solar small" disabled={busy} onClick={() => onAct(r.username, 'accept', t.nowFriends(r.username))}>
                    {t.accept}
                  </button>
                  <button type="button" className="lip pill small" disabled={busy} onClick={() => onAct(r.username, 'remove')}>
                    {t.decline}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {v.outgoing.length > 0 ? (
        <section aria-label={t.outgoing}>
          <h3>{t.outgoing}</h3>
          <ul className="friends-list">
            {v.outgoing.map((r) => (
              <li key={r.username} className="friend">
                <div className="friend-main">
                  <span className="friend-name">{r.username}</span>
                  <span className="friend-meta">{copy.social.level(r.level)}</span>
                </div>
                <div className="friend-actions">
                  <button type="button" className="lip pill small" disabled={busy} onClick={() => onAct(r.username, 'remove')}>
                    {t.cancel}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function BlockedTab({ v, onAct, busy }: { v: FriendsView; onAct: (u: string, k: 'unblock') => void; busy: boolean }) {
  return (
    <>
      <p className="friends-cap">{t.blockedNote}</p>
      {v.blocked.length === 0 ? (
        <p className="friends-empty">{t.noBlocked}</p>
      ) : (
        <ul className="friends-list">
          {v.blocked.map((b) => (
            <li key={b.username} className="friend">
              <div className="friend-main">
                <span className="friend-name">{b.username}</span>
              </div>
              <div className="friend-actions">
                <button type="button" className="lip pill small" disabled={busy} onClick={() => onAct(b.username, 'unblock')}>
                  {t.unblock}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PrivacyTab({ v, onNotice }: { v: FriendsView; onNotice: (s: string) => void }) {
  const prefs = useSocialPrefs();
  const id = useId();
  const save = (next: Partial<FriendsView['prefs']>) => prefs.mutate({ ...v.prefs, ...next }, { onSuccess: () => onNotice(t.saved) });
  return (
    <div className="friends-privacy">
      <label htmlFor={id}>{t.privacyInvites}</label>
      <select id={id} value={v.prefs.invites} disabled={prefs.isPending} onChange={(e) => save({ invites: e.target.value as InvitePolicy })}>
        {(['everyone', 'friends', 'nobody'] as const).map((k) => (
          <option key={k} value={k}>
            {t.invites[k]}
          </option>
        ))}
      </select>
      <label className="check">
        <input type="checkbox" checked={v.prefs.showStatus} disabled={prefs.isPending} onChange={(e) => save({ showStatus: e.target.checked })} />
        <span>{t.privacyStatus}</span>
      </label>
      {prefs.isError ? (
        <p className="field-error" role="alert">
          {errorText(prefs.error, copy.errors)}
        </p>
      ) : null}
    </div>
  );
}
