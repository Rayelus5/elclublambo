import type { MeResponse, Wallet } from '@galaxy/shared';
import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { isAdmin } from '../auth/useMe';
import { copy } from '../copy/es';
import { useUi } from '../state/ui';
import { Icon } from '../ui/Icon';
import { Avatar } from './Avatar';
import { Soon } from './Soon';
import { WalletBar } from './WalletBar';

const delay = (d: string) => ({ '--d': d }) as CSSProperties;

/**
 * The title screen's top bar (DESIGN_SYSTEM §7): shortcuts on the left (the deep scan, with its free-pull notice),
 * the operator and their balances on the right, then the mailbox and Salir. Mercado leads to the market (M5c-1) and Comunidad opens the chat sheet (M5b-2). Balances are read as whole sentences.
 */
export function TopBar({
  me,
  wallet,
  freePull,
  onLogout,
  leaving,
}: {
  me: MeResponse;
  wallet: Wallet | undefined;
  freePull: boolean;
  onLogout: () => void;
  leaving: boolean;
}) {
  const chatOpen = useUi((s) => s.chat !== null);
  const openChat = useUi((s) => s.openChat);
  const closeChat = useUi((s) => s.closeChat);
  return (
    <header className="topbar">
      <nav className="group" aria-label={copy.hub.shortcuts}>
        <Link to="/escaner" className="lip pill pill-solar enter" style={delay('.95s')}>
          <Icon name="radar" />
          <span>{copy.hub.scanner}</span>
          {freePull ? <span className="badge-new">{copy.hub.freePull}</span> : null}
        </Link>
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
      </nav>
      <div className="group">
        <div className="lip panel hud enter" style={delay('1s')}>
          <Link to={`/perfil/${encodeURIComponent(me.username)}`} className="me">
            <Avatar name={me.username} />
            <div>
              <b>{me.username}</b>
              {me.level ? <span className="me-level">{copy.social.level(me.level)}</span> : null}
              {isAdmin(me) ? <span className="badge-admin">{copy.hub.admin}</span> : null}
            </div>
            {/* Its name keeps what it shows (label in name) and says where it leads. */}
            <span className="sr-only">{copy.social.yourProfile}</span>
          </Link>
          <WalletBar wallet={wallet} />
        </div>
        {isAdmin(me) && me.mfa ? (
          <Link to="/admin" className="lip iconbtn enter" style={delay('1.05s')} aria-label={copy.admin.title} title={copy.admin.title}>
            <Icon name="shield" />
          </Link>
        ) : null}
        <button
          type="button"
          className="lip iconbtn locked enter"
          style={delay('1.05s')}
          disabled
          aria-label={`${copy.hub.mailbox}, ${copy.hub.soon.toLowerCase()}`}
          title={`${copy.hub.mailbox}, ${copy.hub.soon.toLowerCase()}`}
        >
          <Icon name="mail" />
          <Soon />
        </button>
        <button
          type="button"
          className="lip iconbtn enter"
          style={delay('1.1s')}
          onClick={onLogout}
          disabled={leaving}
          aria-label={copy.hub.logout}
          title={copy.hub.logout}
        >
          <Icon name="exit" />
        </button>
      </div>
    </header>
  );
}
