import { copy, fmt } from '../copy/es';
import { Icon } from './Icon';

/**
 * An amount of coins as the market shows it (the owner, 2026-11-14: «elimina el texto Monedas y reemplazalo por el
 * icono»): the number grouped (1.000.000.000), after the coin icon when `icon` (else the place already shows it);
 * «monedas» is there only for screen readers.
 */
export function CoinAmount({ n, icon = false }: { n: number; icon?: boolean }) {
  return (
    <span className={icon ? 'coin-amount with-icon' : 'coin-amount'}>
      {icon ? <Icon name="coin" /> : null}
      <span>{fmt(n)}</span>
      <span className="sr-only">{copy.market.coinWord(n)}</span>
    </span>
  );
}
