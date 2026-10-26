"use client";

import { useSyncExternalStore } from "react";
import { CircleCheck, ExternalLink } from "lucide-react";
import { explorerTx, type ChainId } from "@/lib/economy/networks";
import { getDictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";

export type RevokeNotice = { key: string; hash: `0x${string}`; token: string };

// «Permiso retirado» confirmations, kept in memory for the tab per (chain, owner) outside the list's React tree: the
// router.refresh() after a revoke re-runs the page, and when that hit is answered rate_limited the list is replaced by
// the alert. The page renders <RevokeNotices> above the list in both cases, so the confirmation and its tx link stay.

const EMPTY: readonly RevokeNotice[] = [];
const store = new Map<string, readonly RevokeNotice[]>();
const listeners = new Set<() => void>();
const scopeOf = (chainId: ChainId, owner: string) => `${chainId}:${owner.toLowerCase()}`;

/** Adds (or replaces, by pair key) a confirmation for `owner` on `chainId`. */
export function addRevokeNotice(chainId: ChainId, owner: string, notice: RevokeNotice): void {
  const scope = scopeOf(chainId, owner);
  store.set(scope, [...(store.get(scope) ?? EMPTY).filter((n) => n.key !== notice.key), notice]);
  for (const l of listeners) l();
}

/** Tests only: forget every confirmation. */
export function resetRevokeNotices(): void {
  store.clear();
  for (const l of listeners) l();
}

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
};

/** The confirmations of this lookup, announced politely; nothing (but the live region) when there are none. */
export function RevokeNotices({ lang, chainId, owner }: { lang: Lang; chainId: ChainId; owner: string }) {
  const t = getDictionary(lang).approvals.list;
  const scope = scopeOf(chainId, owner);
  const notices = useSyncExternalStore(
    subscribe,
    () => store.get(scope) ?? EMPTY,
    () => EMPTY,
  );
  return (
    <div aria-live="polite" className="flex flex-col gap-2">
      {notices.map((n) => (
        <p key={n.key} role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-control border border-success/60 px-3 text-sm text-fg">
          <CircleCheck aria-hidden className="size-4 shrink-0 text-success" />
          <span className="font-bold text-success">{t.revoked}</span>
          <span className="text-fg-muted">{n.token}</span>
          <a
            href={explorerTx(chainId, n.hash)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1 text-accent underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            {t.viewTx}
            <ExternalLink aria-hidden className="size-3.5 shrink-0" />
          </a>
        </p>
      ))}
    </div>
  );
}
