import type { ChatMessage } from '@galaxy/shared';
import { Link } from 'react-router';
import { copy } from '../copy/es';
import { Avatar } from '../hub/Avatar';

const t = copy.chat;
export const clock = (iso: string) => new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/**
 * One message (DESIGN_SYSTEM §8 terdecies): the author's avatar and name (to their profile), level, clan tag and time,
 * then the text as written (line breaks kept). Others' messages can be reported once; moderators also hide them and
 * mute their author. The actions show on hover or keyboard focus, and are always reachable with Tab; a reported
 * message says so next to its time.
 */
export function ChatMessageItem({
  m,
  own,
  showClan,
  moderator,
  canReport,
  reported,
  busy,
  onReport,
  onHide,
  onMute,
}: {
  m: ChatMessage;
  own: boolean;
  showClan: boolean;
  moderator: boolean;
  /** Reports count from accounts with the level that writing needs: below it there is no «Denunciar». */
  canReport: boolean;
  reported: boolean;
  busy: boolean;
  onReport: () => void;
  onHide: () => void;
  onMute: () => void;
}) {
  const u = m.author.username;
  return (
    <li className={`chat-msg${own ? ' own' : ''}`}>
      <Avatar name={u} />
      <div className="chat-msg-main">
        <p className="chat-msg-head">
          <Link to={`/perfil/${encodeURIComponent(u)}`} className="chat-author">
            {u}
          </Link>
          <span className="chat-level">{copy.social.level(m.author.level)}</span>
          {showClan && m.author.clan ? <span className="clan-tag">{m.author.clan}</span> : null}
          {reported ? <span className="chat-reported">{t.reported}</span> : null}
          <time dateTime={m.at}>{clock(m.at)}</time>
        </p>
        <p className="chat-body">{m.body}</p>
      </div>
      {own || ((reported || !canReport) && !moderator) ? null : (
        <div className="chat-msg-actions">
          {reported || !canReport ? null : (
            <button type="button" className="chat-action" aria-label={t.reportOf(u)} onClick={onReport}>
              {t.report}
            </button>
          )}
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
