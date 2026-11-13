import { parseConfig, type ReferralFlag, type ReferralState } from '@galaxy/shared';
import { useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useConfigKeys } from '../../api/config';
import { copy } from '../../copy/es';
import { useFollowAnchor } from '../../ui/popup';

// What the tabs of «Referidos» share (plan «referidos», part R2): the live rules, the address as the tabs' memory, the
// marks of a held sign-up explained, the state of a sign-up, and a browser in words.

const t = copy.admin.referrals;

/** The live `referrals` key: its row (for the embedded editor) and its values with the defaults filled in. */
export function useReferralsConfig() {
  const keys = useConfigKeys();
  const row = keys.data?.find((k) => k.key === 'referrals');
  const cfg = useMemo(() => (row ? parseConfig('referrals', row.data) : null), [row]);
  return { row, cfg, error: keys.error };
}

/** The address's search params, and a change to some of them (null removes one), replacing the entry. */
export function useParamsChange(): [URLSearchParams, (next: Record<string, string | null>) => void] {
  const [params, setParams] = useSearchParams();
  const change = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p, { replace: true });
  };
  return [params, change];
}

/** A sign-up's state in the address, in Spanish. */
export const STATE_URL: Record<ReferralState, string> = { pending: 'esperando', held: 'retenidos', rewarded: 'premiados', rejected: 'rechazados' };
/** The state a `?estado=` asks for, or null for every state. */
export const stateFromUrl = (v: string | null): ReferralState | null => (Object.entries(STATE_URL) as [ReferralState, string][]).find(([, slug]) => slug === v)?.[0] ?? null;

const STATE_TONE: Record<ReferralState, string> = { pending: '', held: 'warn', rewarded: 'ok', rejected: 'bad' };

/** A sign-up's state as a chip: amber held, green rewarded, red rejected. */
export function StateChip({ state }: { state: ReferralState }) {
  return <span className={`admin-chip ref-chip ${STATE_TONE[state]}`}>{t.states[state]}</span>;
}

const TIP = { maxHeight: 200, matchWidth: false } as const;

/**
 * Why a sign-up was held, as a chip with its explanation: a tooltip on hover and on keyboard focus (WAI-ARIA tooltip:
 * the chip is described by it, Escape hides it). It floats over the page, so the table's own scroll never clips it.
 */
export function FlagChip({ flag }: { flag: ReferralFlag }) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  useFollowAnchor(open, anchor, tip, TIP, () => setOpen(false));
  return (
    <>
      <span
        ref={anchor}
        className="admin-chip warn ref-chip ref-flag"
        tabIndex={0}
        aria-describedby={id}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape' || !open) return;
          e.stopPropagation();
          setOpen(false);
        }}
      >
        {t.flags[flag]}
      </span>
      <span ref={tip} id={id} role="tooltip" className="ref-tip" hidden={!open}>
        {t.flagHelp[flag]}
      </span>
    </>
  );
}

const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];
// Android and iOS first: their browsers also say Linux and «like Mac OS X».
const SYSTEMS: [RegExp, string][] = [
  [/Android/, 'Android'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Windows/, 'Windows'],
  [/CrOS/, 'ChromeOS'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Linux/, 'Linux'],
];

/** «Chrome en Windows» from a user agent; the whole of it stays in the cell's title. */
export function browserOf(ua: string | null): string | null {
  if (!ua) return null;
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1];
  if (!browser) return system ? t.browserOn(t.otherBrowser, system) : t.otherBrowser;
  return system ? t.browserOn(browser, system) : browser;
}
