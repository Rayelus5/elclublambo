import type { Wallet } from '@galaxy/shared';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
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

/** Where a chip leads: a screen (not shown as a link when you are already there) or an action on this screen. */
type Lead = { to: string; label: string } | { onOpen: () => void; label: string };

function Resource({ kind, icon, amount, label, lead }: { kind: string; icon: IconName; amount: number; label: string; lead?: Lead }) {
  const { shown, climbing } = useCountUp(amount);
  const loc = useLocation();
  const className = `res ${kind}${climbing ? ' climbing' : ''}`;
  const body = (
    <>
      <Icon name={icon} />
      <b aria-hidden="true">{fmt(shown)}</b>
    </>
  );
  const here = lead && 'to' in lead && `${loc.pathname}${loc.search}` === lead.to;
  if (lead && !here) {
    const name = `${label}. ${lead.label}`;
    if ('to' in lead) {
      return (
        <Link to={lead.to} className={`${className} res-link`} aria-label={name} title={name} data-sfx="hover">
          {body}
        </Link>
      );
    }
    return (
      <button type="button" className={`${className} res-link`} onClick={lead.onOpen} aria-label={name} title={name}>
        {body}
      </button>
    );
  }
  return (
    <span className={className} role="img" aria-label={label} title={label}>
      {body}
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
 * left when it closes becomes star dust). Where components are spent (the Hangar's probe levels, M4b-1) they join,
 * and in the station material too (it opens the refinery that turns it into components). Each chip leads where its
 * resource is used: the signals to the Escáner, the event ones to its event tab.
 */
export function WalletBar({ wallet, components = false, material }: { wallet: Wallet | undefined; components?: boolean; material?: { onOpen: () => void } }) {
  const eventCurrencies = (useGacha().data?.banners ?? []).filter((b) => b.kind === 'event').map((b) => b.currency);
  if (!wallet) {
    return (
      <span className="res pending" role="img" aria-label={copy.loading}>
        ⠋⠙⠹
      </span>
    );
  }
  const r = copy.hub.resource;
  const events = eventTickets(wallet, eventCurrencies);
  return (
    <>
      {material ? (
        <Resource kind="material" icon="cube" amount={wallet['material'] ?? 0} label={copy.station.resource.material(wallet['material'] ?? 0)} lead={{ onOpen: material.onOpen, label: r.goTo.refinery }} />
      ) : null}
      {components ? (
        <Resource kind="components" icon="wrench" amount={wallet['components'] ?? 0} label={copy.station.resource.components(wallet['components'] ?? 0)} />
      ) : null}
      <Resource kind="dust" icon="dust" amount={wallet.dust} label={r.dust(wallet.dust)} />
      <Resource kind="coins" icon="coin" amount={wallet.coins} label={r.coins(wallet.coins)} />
      <Resource kind="signal" icon="ticket" amount={wallet.signal} label={r.signal(wallet.signal)} lead={{ to: '/escaner', label: r.goTo.scanner }} />
      {eventCurrencies.length > 0 ? (
        <Resource kind="event-signal" icon="ticket" amount={events} label={r.eventSignal(events)} lead={{ to: '/escaner?tipo=evento', label: r.goTo.eventScanner }} />
      ) : null}
    </>
  );
}
