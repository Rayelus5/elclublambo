import type { ChatMessage } from '@galaxy/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { copy } from '../copy/es';
import { Avatar } from '../hub/Avatar';

const t = copy.chat;
export const clock = (iso: string) => new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

const MENTION = /(?<![\p{L}\p{N}_@.])@([a-z0-9_]{3,20})(?![a-z0-9_@])/giu;

/** The text with each «@nombre» marked (mine stronger), as text: nothing is ever drawn as HTML. */
export function withMentions(body: string, me: string): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of body.matchAll(MENTION)) {
    const i = m.index ?? 0;
    if (i > at) out.push(body.slice(at, i));
    const mine = m[1]!.toLowerCase() === me.toLowerCase();
    out.push(
      <span key={i} className={`chat-mention${mine ? ' mine' : ''}`}>
        {m[0]}
      </span>,
    );
    at = i + m[0].length;
  }
  if (at < body.length) out.push(body.slice(at));
  return out;
}

/**
 * One message (DESIGN_SYSTEM §8 terdecies): the author's avatar and name (to their profile), level, clan tag and time,
 * then the text as written (line breaks kept, «@nombres» marked). One that follows its author's within minutes joins it
 * (`cont`: no avatar nor name again; the time shows on hover). One that names me stands out. Others' messages can be
 * reported once and their author blocked (always asked first); moderators also hide them and mute their author. The
 * actions show on hover or keyboard focus, and are always reachable with Tab.
 */
export function ChatMessageItem({
  m,
  me,
  own,
  cont,
  mentionsMe,
  showClan,
  moderator,
  canReport,
  reported,
  busy,
  onReport,
  onHide,
  onMute,
  onBlock,
}: {
  m: ChatMessage;
  me: string;
  own: boolean;
  cont: boolean;
  mentionsMe: boolean;
  showClan: boolean;
  moderator: boolean;
  /** Reports count from accounts with the level that writing needs: below it there is no «Denunciar». */
  canReport: boolean;
  reported: boolean;
  busy: boolean;
  onReport: () => void;
  onHide: () => void;
  onMute: () => void;
  onBlock: () => void;
}) {
  const u = m.author.username;
  return (
    <li className={`chat-msg${own ? ' own' : ''}${cont ? ' cont' : ''}${mentionsMe ? ' mentions-me' : ''}`}>
      {cont ? (
        <time className="chat-cont-time" dateTime={m.at} aria-hidden="true">
          {clock(m.at)}
        </time>
      ) : (
        <Avatar name={u} avatar={m.author.avatar} frame={m.author.frame} />
      )}
      <div className="chat-msg-main">
        {cont ? (
          <span className="sr-only">{`${u}, ${clock(m.at)}`}</span>
        ) : (
          <p className="chat-msg-head">
            <Link to={`/perfil/${encodeURIComponent(u)}`} className="chat-author">
              {u}
            </Link>
            <span className="chat-level">{copy.social.level(m.author.level)}</span>
            {showClan && m.author.clan ? <span className="clan-tag">{m.author.clan}</span> : null}
            {reported ? <span className="chat-reported">{t.reported}</span> : null}
            <time dateTime={m.at}>{clock(m.at)}</time>
          </p>
        )}
        <p className="chat-body">
          {mentionsMe ? <span className="sr-only">{`${t.mentionsYou}. `}</span> : null}
          {withMentions(m.body, me)}
        </p>
        {cont && reported ? <span className="chat-reported">{t.reported}</span> : null}
      </div>
      {own ? null : (
        <div className="chat-msg-actions">
          {reported || !canReport ? null : (
            <button type="button" className="chat-action" aria-label={t.reportOf(u)} onClick={onReport}>
              {t.report}
            </button>
          )}
          <button type="button" className="chat-action" aria-haspopup="dialog" aria-label={t.blockOf(u)} onClick={onBlock}>
            {t.block}
          </button>
          {moderator ? (
            <>
              <button type="button" className="chat-action" aria-label={t.hideOf(u)} disabled={busy} onClick={onHide}>
                {t.hide}
              </button>
              <button type="button" className="chat-action danger" aria-label={t.muteOf(u)} onClick={onMute}>
                {t.mute}
              </button>
            </>
          ) : null}
        </div>
      )}
    </li>
  );
}
