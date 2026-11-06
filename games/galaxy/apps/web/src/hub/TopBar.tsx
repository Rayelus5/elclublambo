import type { MeResponse, Wallet } from '@galaxy/shared';
import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { isAdmin } from '../auth/useMe';
import { copy, fmt } from '../copy/es';
import { Icon, type IconName } from '../ui/Icon';
import { Avatar } from './Avatar';
import { Soon } from './Soon';

const delay = (d: string) => ({ '--d': d }) as CSSProperties;

function Resource({ kind, icon, amount, label }: { kind: string; icon: IconName; amount: number; label: string }) {
  return (
    <span className={`res ${kind}`} role="img" aria-label={label} title={label}>
      <Icon name={icon} />
      <b aria-hidden="true">{fmt(amount)}</b>
    </span>
  );
}

/**
 * The title screen's top bar (DESIGN_SYSTEM §7): shortcuts on the left (the deep scan, with its free-pull notice),
 * the operator and their balances on the right, then the mailbox and Salir. Balances are read as whole sentences.
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
  return (
    <header className="topbar">
      <nav className="group" aria-label={copy.hub.shortcuts}>
        <Link to="/escaner" className="lip pill pill-solar enter" style={delay('.95s')}>
          <Icon name="radar" />
          <span>{copy.hub.scanner}</span>
          {freePull ? <span className="badge-new">{copy.hub.freePull}</span> : null}
        </Link>
        <button type="button" className="lip pill locked fold enter" style={delay('1s')} disabled title={copy.hub.soon}>
          <Icon name="store" />
          <span className="label">{copy.hub.market}</span>
          <Soon />
        </button>
        <button type="button" className="lip pill locked fold enter" style={delay('1.05s')} disabled title={copy.hub.soon}>
          <Icon name="chat" />
          <span className="label">{copy.hub.community}</span>
          <Soon />
        </button>
      </nav>
      <div className="group">
        <div className="lip panel hud enter" style={delay('1s')}>
          <div className="me">
            <Avatar name={me.username} />
            <div>
              <b>{me.username}</b>
              {isAdmin(me) ? <span className="badge-admin">{copy.hub.admin}</span> : null}
            </div>
          </div>
          {wallet ? (
            <>
              <Resource kind="dust" icon="dust" amount={wallet.dust} label={copy.hub.resource.dust(wallet.dust)} />
              <Resource kind="coins" icon="coin" amount={wallet.coins} label={copy.hub.resource.coins(wallet.coins)} />
              <Resource kind="signal" icon="ticket" amount={wallet.signal} label={copy.hub.resource.signal(wallet.signal)} />
            </>
          ) : (
            <span className="res pending" role="status" aria-label={copy.loading}>
              ⠋⠙⠹
            </span>
          )}
        </div>
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
