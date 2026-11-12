import type { MeResponse, Wallet } from '@galaxy/shared';
import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { isAdmin, isStaff } from '../auth/useMe';
import { useFriends } from '../api/friends';
import { MailButton } from '../mail/Mailbox';
import { MissionsButton } from '../missions/MissionsScreen';
import { LeftoversNotice } from './Leftovers';
import { NewsButton } from './News';
import { copy } from '../copy/es';
import { useUi } from '../state/ui';
import { Icon } from '../ui/Icon';
import { Avatar } from './Avatar';
import { WalletBar } from './WalletBar';

const delay = (d: string) => ({ '--d': d }) as CSSProperties;

/**
 * The title screen's top bar (DESIGN_SYSTEM §7): shortcuts on the left (the deep scan with its free-pull notice, only
 * where the page has no scanner button of its own: the title menu has it as a big button),
 * the operator and their balances on the right, then the mailbox and Salir. Mercado leads to the market (M5c-1), Comunidad opens the chat sheet (M5b-2)
 * and Noticias the notices and multipliers (open beta). Balances are read as whole sentences.
 */
export function TopBar({
  me,
  wallet,
  freePull,
  onLogout,
  leaving,
  scanner = true,
}: {
  me: MeResponse;
  wallet: Wallet | undefined;
  freePull: boolean;
  /** Salir: only on the title screen (the lobby keeps the rest of the bar). */
  onLogout?: () => void;
  leaving?: boolean;
  /** The deep scan's shortcut (the title menu leaves it out: its own Escáner button leads there). */
  scanner?: boolean;
}) {
  const chatOpen = useUi((s) => s.chat !== null);
  const openChat = useUi((s) => s.openChat);
  const closeChat = useUi((s) => s.closeChat);
  const friendsOpen = useUi((s) => s.friends);
  const openFriends = useUi((s) => s.openFriends);
  const closeFriends = useUi((s) => s.closeFriends);
  const friends = useFriends().data;
  const online = friends?.friends.filter((f) => f.presence.status === 'online').length ?? 0;
  const requests = friends?.incoming.length ?? 0;
  return (
    <header className="topbar">
      <nav className="group" aria-label={copy.hub.shortcuts}>
        {scanner ? (
          <Link to="/escaner" className="lip pill pill-solar enter" style={delay('.95s')} data-tour="scanner">
            <Icon name="radar" />
            <span>{copy.hub.scanner}</span>
            {freePull ? <span className="badge-new">{copy.hub.freePull}</span> : null}
          </Link>
        ) : null}
        <Link to="/mercado" className="lip pill fold enter" style={delay('1s')}>
          <Icon name="store" />
          <span className="label">{copy.hub.market}</span>
        </Link>
        <button
          type="button"
          className="lip pill fold enter"
          style={delay('1.05s')}
          aria-haspopup="dialog"
          aria-expanded={chatOpen}
          onClick={() => (chatOpen ? closeChat() : openChat('global'))}
        >
          <Icon name="chat" />
          <span className="label">{copy.hub.community}</span>
        </button>
        <button
          type="button"
          className="lip pill fold enter friends-button"
          style={delay('1.08s')}
          aria-haspopup="dialog"
          aria-expanded={friendsOpen}
          aria-label={copy.friends.buttonLabel(online, requests)}
          onClick={() => (friendsOpen ? closeFriends() : openFriends())}
        >
          <Icon name="clan" />
          <span className="label">{copy.friends.button}</span>
          {online > 0 ? (
            <span className="friends-online" aria-hidden="true">
              {online}
            </span>
          ) : null}
          {requests > 0 ? <span className="friends-request" aria-hidden="true" /> : null}
        </button>
        <NewsButton style={delay('1.11s')} />
      </nav>
      <div className="group">
        <div className="lip panel hud enter" style={delay('1s')} data-tour="wallet">
          <Link to={`/perfil/${encodeURIComponent(me.username)}`} className="me">
            <Avatar name={me.username} avatar={me.avatar} frame={me.frame} />
            <div>
              <b>{me.username}</b>
              {me.level ? <span className="me-level">{copy.social.level(me.level)}</span> : null}
              {isStaff(me) ? <span className="badge-admin">{isAdmin(me) ? copy.hub.admin : copy.hub.moderator}</span> : null}
            </div>
            {/* Its name keeps what it shows (label in name) and says where it leads. */}
            <span className="sr-only">{copy.social.yourProfile}</span>
          </Link>
          <WalletBar wallet={wallet} />
        </div>
        {isStaff(me) && me.mfa ? (
          <Link to="/admin" className="lip iconbtn enter" style={delay('1.05s')} aria-label={copy.admin.title} title={copy.admin.title}>
            <Icon name="shield" />
          </Link>
        ) : null}
        <MissionsButton style={delay('1.02s')} />
        <MailButton style={delay('1.05s')} />
        {onLogout ? (
          <button
            type="button"
            className="lip iconbtn enter"
            style={delay('1.1s')}
            onClick={onLogout}
            disabled={leaving ?? false}
            aria-label={copy.hub.logout}
            title={copy.hub.logout}
          >
            <Icon name="exit" />
          </button>
        ) : null}
      </div>
      <LeftoversNotice />
    </header>
  );
}
