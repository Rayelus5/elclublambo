import type { LiveNotice, NoticeMode } from '@galaxy/shared';
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useFriendAction, useFriends } from '../api/friends';
import { useRoomAction } from '../api/rooms';
import { useHangar } from '../api/runs';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { ResultsScreen } from '../hangar/ResultsScreen';
import { Avatar } from '../hub/Avatar';
import { MailboxDialog } from '../mail/Mailbox';
import { useUi } from '../state/ui';
import { Dialog } from '../ui/Dialog';
import { Icon, type IconName } from '../ui/Icon';
import { type LiveToast, useLive } from './LiveConnection';
import { type NoticeTone, playNotice } from './sfx';

// The live toasts (multiplayer plan phases 3, 5 and 6c; real-time notices plan of 2026-11-12): what happened elsewhere
// that a player should notice, at the top centre of the screen and above any window, three at a time with the newest
// on top (the rest wait their turn). Each has its tone, the other player's avatar or an icon, a title and a detail,
// its buttons, and a bar with the time it has left, which stops while the pointer or the focus is on it. It chimes as
// it shows unless the player chose «Sin sonido». During a run nothing shows: they wait for it to end.

const t = copy.friends;
const n = copy.notices;
const SHOWN = 3;

/** How long a toast stays: a result longest, what asks for an answer longer, a piece of news less. */
function lifeOf(toast: LiveToast): number {
  if (toast.kind === 'coopResult') return 30_000;
  if (toast.kind === 'chat' || toast.kind === 'chatHead') return 8000;
  if (toast.kind === 'request' || toast.kind === 'invite') return 20_000;
  if (toast.kind === 'notice') {
    const x = toast.notice;
    if ((x.kind === 'trade' && (x.event === 'proposed' || x.event === 'confirmed')) || (x.kind === 'clan' && x.event === 'request')) return 20_000;
  }
  return 10_000;
}

function toneOf(toast: LiveToast): NoticeTone {
  if (toast.kind === 'kicked' || toast.kind === 'closed') return 'alert';
  if (toast.kind === 'coopResult') return 'result';
  if (toast.kind !== 'notice') return 'social';
  const x = toast.notice;
  if (x.kind === 'trade') return x.event === 'cancelled' ? 'alert' : 'trade';
  if (x.kind === 'clan') return x.event === 'kicked' || x.event === 'rejected' ? 'alert' : 'clan';
  if (x.kind === 'offer') return x.event === 'accepted' ? 'sale' : x.event === 'received' ? 'trade' : 'alert';
  return x.kind;
}

/** The toast's frame: its face, its words, its buttons, the close button and the time it has left. */
function Shell({ toast, face, title, detail, actions }: { toast: LiveToast; face: ReactNode; title: ReactNode; detail?: ReactNode; actions?: ReactNode }) {
  const dismiss = useLive((s) => s.dismiss);
  const life = lifeOf(toast);
  const [paused, setPaused] = useState(false);
  const left = useRef(life);
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = setTimeout(() => dismiss(toast.id), left.current);
    return () => {
      clearTimeout(timer);
      left.current = Math.max(0, left.current - (Date.now() - started));
    };
  }, [paused, toast.id, dismiss]);
  return (
    <li
      className={`live-toast tone-${toneOf(toast)}${paused ? ' paused' : ''}`}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setPaused(false)}
    >
      <span className="live-toast-face">{face}</span>
      <span className="live-toast-text">
        <b>{title}</b>
        {detail ? <span>{detail}</span> : null}
      </span>
      {actions ? <span className="live-toast-actions">{actions}</span> : null}
      <button type="button" className="lip iconbtn small live-toast-close" aria-label={t.dismiss} title={t.dismiss} onClick={() => dismiss(toast.id)}>
        <Icon name="close" />
      </button>
      <span className="live-toast-time" aria-hidden="true" style={{ '--life': `${life}ms` } as CSSProperties} />
    </li>
  );
}

const IconFace = ({ name }: { name: IconName }) => <Icon name={name} />;
const PlayerFace = ({ p }: { p: { username: string; avatar?: string | null; frame?: string | null } }) => <Avatar name={p.username} avatar={p.avatar} frame={p.frame} />;

function InviteText({ from, sector }: { from: string; sector: string }) {
  const name = useHangar().data?.sectors.find((s) => s.id === sector)?.name ?? sector;
  return <>{copy.coop.toastInvite(from, name)}</>;
}

/** A chat message I am not reading (the owner's chat asks, 2026-11-14): who, where, what, and «Responder». */
function ChatToast({ toast }: { toast: Extract<LiveToast, { kind: 'chat' | 'chatHead' }> }) {
  const dismiss = useLive((s) => s.dismiss);
  const openChat = useUi((s) => s.openChat);
  const c = copy.chat;
  const channel = toast.kind === 'chat' ? toast.message.channel : 'global';
  const where = c.where[channel];
  const open = (
    <button
      type="button"
      className="lip pill pill-solar small"
      onClick={() => {
        dismiss(toast.id);
        openChat(channel);
      }}
    >
      {toast.kind === 'chat' ? c.reply : c.openChat}
    </button>
  );
  if (toast.kind === 'chatHead') return <Shell toast={toast} face={<IconFace name="chat" />} title={c.toastMany(toast.n, where)} actions={open} />;
  const m = toast.message;
  const title = toast.mention ? c.toastMention(m.author.username, where) : toast.n > 1 ? c.toastMany(toast.n, where) : c.toastFrom(m.author.username, where);
  const text = [...m.body].length > 90 ? `${[...m.body].slice(0, 89).join('')}…` : m.body;
  return <Shell toast={toast} face={<PlayerFace p={{ username: m.author.username, avatar: m.author.avatar, frame: m.author.frame }} />} title={title} detail={<span className="live-toast-quote">{text}</span>} actions={open} />;
}

/** A notice from the server (a trade, a sale, a mail, my clan, an achievement): its words and where it leads. */
function NoticeToast({ toast, notice }: { toast: LiveToast; notice: LiveNotice }) {
  const dismiss = useLive((s) => s.dismiss);
  const navigate = useNavigate();
  const go = (to: string) => () => {
    dismiss(toast.id);
    void navigate(to);
  };
  const see = (to: string, label: string = n.see) => (
    <button type="button" className="lip pill pill-solar small" onClick={go(to)}>
      {label}
    </button>
  );
  switch (notice.kind) {
    case 'trade':
      return <Shell toast={toast} face={<PlayerFace p={notice.from} />} title={n.trade[notice.event](notice.from.username)} actions={see('/mercado?pestana=trueques')} />;
    case 'sale':
      return <Shell toast={toast} face={<PlayerFace p={notice.buyer} />} title={n.sale(notice.galaxy.name)} detail={n.saleDetail(notice.buyer.username, notice.net)} actions={see('/mercado?pestana=mios')} />;
    case 'mail':
      return (
        <Shell
          toast={toast}
          face={<IconFace name="mail" />}
          title={n.mail}
          detail={notice.title}
          actions={
            <button
              type="button"
              className="lip pill pill-solar small"
              onClick={() => {
                dismiss(toast.id);
                useLive.setState({ shownMail: true });
              }}
            >
              {n.open}
            </button>
          }
        />
      );
    case 'clan': {
      const out = notice.event === 'kicked' || notice.event === 'rejected';
      const title = notice.event === 'request' ? n.clan.request(notice.who?.username ?? '') : n.clan[notice.event](notice.clan.name);
      const detail = notice.event !== 'request' && notice.who ? n.by(notice.who.username) : undefined;
      return <Shell toast={toast} face={notice.who ? <PlayerFace p={notice.who} /> : <IconFace name="clan" />} title={title} detail={detail} actions={see(out ? '/clanes' : `/clanes/${encodeURIComponent(notice.clan.tag)}`)} />;
    }
    case 'achievement':
      return <Shell toast={toast} face={<IconFace name="trophy" />} title={n.achievement} detail={notice.name} actions={see('/misiones?pestana=logros', n.collect)} />;
    case 'offer': {
      const o = n.offer;
      const title = notice.event === 'received' ? o.received(notice.from?.username ?? '', notice.amount, notice.galaxy.name) : o[notice.event](notice.galaxy.name);
      const detail = notice.event === 'received' || notice.event === 'accepted' ? undefined : o.back(notice.amount);
      return (
        <Shell
          toast={toast}
          face={notice.from ? <PlayerFace p={notice.from} /> : <IconFace name="coin" />}
          title={title}
          detail={detail}
          actions={notice.event === 'accepted' ? see(`/coleccion/${notice.galaxy.id}`) : see('/mercado?pestana=ofertas')}
        />
      );
    }
  }
}

function Toast({ toast }: { toast: LiveToast }) {
  const dismiss = useLive((s) => s.dismiss);
  const openFriends = useUi((s) => s.openFriends);
  const action = useFriendAction();
  const room = useRoomAction();
  const navigate = useNavigate();
  if (toast.kind === 'notice') return <NoticeToast toast={toast} notice={toast.notice} />;
  if (toast.kind === 'chat' || toast.kind === 'chatHead') return <ChatToast toast={toast} />;
  if (toast.kind === 'coopResult') {
    return (
      <Shell
        toast={toast}
        face={<IconFace name="trophy" />}
        title={copy.coop.resultToast}
        actions={
          <button
            type="button"
            className="lip pill pill-solar small"
            onClick={() => {
              useLive.setState({ shownResult: toast.result });
              dismiss(toast.id);
            }}
          >
            {copy.coop.resultSee}
          </button>
        }
      />
    );
  }
  if (toast.kind === 'kicked' || toast.kind === 'closed') {
    return <Shell toast={toast} face={<IconFace name="alert" />} title={toast.kind === 'kicked' ? copy.coop.kicked : copy.coop.closed} />;
  }
  if (toast.kind === 'invite') {
    return (
      <Shell
        toast={toast}
        face={<PlayerFace p={{ username: toast.username }} />}
        title={<InviteText from={toast.username} sector={toast.invite.sector} />}
        detail={room.isError ? <span className="live-toast-error">{errorText(room.error, copy.errors)}</span> : undefined}
        actions={
          <button
            type="button"
            className="lip pill pill-solar small"
            disabled={room.isPending}
            onClick={() =>
              room.mutate(
                { kind: 'join', code: toast.invite.code },
                {
                  onSuccess: () => {
                    dismiss(toast.id);
                    void navigate('/incursion');
                  },
                },
              )
            }
          >
            {copy.coop.accept}
          </button>
        }
      />
    );
  }
  return (
    <Shell
      toast={toast}
      face={<PlayerFace p={{ username: toast.username }} />}
      title={toast.kind === 'request' ? t.toastRequest(toast.username) : t.toastAccepted(toast.username)}
      actions={
        <>
          {toast.kind === 'request' ? (
            <button
              type="button"
              className="lip pill pill-solar small"
              disabled={action.isPending}
              onClick={() => action.mutate({ username: toast.username, action: 'accept' }, { onSuccess: () => dismiss(toast.id) })}
            >
              {t.accept}
            </button>
          ) : null}
          <button
            type="button"
            className="lip pill small"
            onClick={() => {
              openFriends();
              dismiss(toast.id);
            }}
          >
            {t.see}
          </button>
        </>
      }
    />
  );
}

/** The chime of each toast as it first shows (not while it waits, not during a run), unless «Sin sonido». */
function useChimes(shown: LiveToast[], mode: NoticeMode): void {
  const heard = useRef(new Set<number>());
  useEffect(() => {
    for (const toast of shown) {
      if (heard.current.has(toast.id)) continue;
      heard.current.add(toast.id);
      if (mode === 'sound') playNotice(toneOf(toast));
    }
  }, [shown, mode]);
}

export function LiveToasts() {
  const toasts = useLive((s) => s.toasts);
  const running = useLive((s) => s.run !== null);
  const shownResult = useLive((s) => s.shownResult);
  const shownMail = useLive((s) => s.shownMail);
  const mode = useFriends(false).data?.prefs.notices ?? 'sound';
  // The oldest three show (the rest wait), the newest of them on top; none during a run.
  const shown = running ? [] : toasts.slice(0, SHOWN);
  useChimes(shown, mode);
  return (
    <>
      {/* A polite live region, not role=status: the screens keep their own status messages as the only one. */}
      <ul className="live-toasts" aria-live="polite" aria-relevant="additions">
        {[...shown].reverse().map((toast) => (
          <Toast key={toast.id} toast={toast} />
        ))}
      </ul>
      {/* The result of a group run I had left (phase 6c), opened from its notice. */}
      {shownResult && !running ? (
        <Dialog title={copy.coop.resultTitle} hideTitle onClose={() => useLive.setState({ shownResult: null })} className="coop-result-dialog">
          <ResultsScreen result={shownResult} onAgain={() => useLive.setState({ shownResult: null })} />
        </Dialog>
      ) : null}
      {/* The mailbox, opened from a mail's notice. */}
      {shownMail && !running ? <MailboxDialog onClose={() => useLive.setState({ shownMail: false })} /> : null}
    </>
  );
}
