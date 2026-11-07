import type { Wallet } from '@galaxy/shared';
import { copy, fmt } from '../copy/es';
import { Icon, type IconName } from '../ui/Icon';

function Resource({ kind, icon, amount, label }: { kind: string; icon: IconName; amount: number; label: string }) {
  return (
    <span className={`res ${kind}`} role="img" aria-label={label} title={label}>
      <Icon name={icon} />
      <b aria-hidden="true">{fmt(amount)}</b>
    </span>
  );
}

/**
 * Dust, coins and signals (DESIGN_SYSTEM §7), each read as a whole sentence; a braille spinner until it loads. Where
 * components are spent (the Hangar's probe levels, M4b-1) they join the bar.
 */
export function WalletBar({ wallet, components = false }: { wallet: Wallet | undefined; components?: boolean }) {
  if (!wallet) {
    return (
      <span className="res pending" role="img" aria-label={copy.loading}>
        ⠋⠙⠹
      </span>
    );
  }
  return (
    <>
      <Resource kind="dust" icon="dust" amount={wallet.dust} label={copy.hub.resource.dust(wallet.dust)} />
      <Resource kind="coins" icon="coin" amount={wallet.coins} label={copy.hub.resource.coins(wallet.coins)} />
      <Resource kind="signal" icon="ticket" amount={wallet.signal} label={copy.hub.resource.signal(wallet.signal)} />
      {components ? (
        <Resource kind="components" icon="wrench" amount={wallet['components'] ?? 0} label={copy.station.resource.components(wallet['components'] ?? 0)} />
      ) : null}
    </>
  );
}
