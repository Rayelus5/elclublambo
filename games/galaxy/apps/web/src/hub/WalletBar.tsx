import type { Wallet } from '@galaxy/shared';
import { useEffect, useRef, useState } from 'react';
import { useGacha } from '../api/economy';
import { copy, fmt } from '../copy/es';
import { Icon, type IconName } from '../ui/Icon';
import { useReducedMotion } from '../ui/motion';

/** A number that climbs to its new value when it grows (0.7 s, eased); at once with reduced motion. */
function useCountUp(value: number): { shown: number; climbing: boolean } {
  const reduced = useReducedMotion();
  const last = useRef(value);
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    const from = last.current;
    last.current = value;
    if (reduced || value <= from || typeof requestAnimationFrame !== 'function') return;
    const start = performance.now();
    let raf = requestAnimationFrame(function tick(now: number) {
      const k = Math.min(1, (now - start) / 700);
      setShown(k >= 1 ? null : Math.round(from + (value - from) * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);
  return { shown: shown ?? value, climbing: shown !== null };
}

function Resource({ kind, icon, amount, label }: { kind: string; icon: IconName; amount: number; label: string }) {
  const { shown, climbing } = useCountUp(amount);
  return (
    <span className={`res ${kind}${climbing ? ' climbing' : ''}`} role="img" aria-label={label} title={label}>
      <Icon name={icon} />
      <b aria-hidden="true">{fmt(shown)}</b>
    </span>
  );
}

/** The event signals held for the event scanners open now (each event's own `signal:<id>`, together). */
export function eventTickets(wallet: Wallet | undefined, currencies: readonly string[]): number {
  if (!wallet) return 0;
  return [...new Set(currencies)].reduce((n, c) => n + (wallet[c] ?? 0), 0);
}

/**
 * Dust, coins and signals (DESIGN_SYSTEM §7), each read as a whole sentence; a braille spinner until it loads. The
 * event signals (open beta) have their own ticket, the same but purple, only while an event scanner is open (what is
 * left when it closes becomes star dust). Where components are spent (the Hangar's probe levels, M4b-1) they join.
 */
export function WalletBar({ wallet, components = false }: { wallet: Wallet | undefined; components?: boolean }) {
  const eventCurrencies = (useGacha().data?.banners ?? []).filter((b) => b.kind === 'event').map((b) => b.currency);
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
      {eventCurrencies.length > 0 ? (
        <Resource kind="event-signal" icon="ticket" amount={eventTickets(wallet, eventCurrencies)} label={copy.hub.resource.eventSignal(eventTickets(wallet, eventCurrencies))} />
      ) : null}
      {components ? (
        <Resource kind="components" icon="wrench" amount={wallet['components'] ?? 0} label={copy.station.resource.components(wallet['components'] ?? 0)} />
      ) : null}
    </>
  );
}
