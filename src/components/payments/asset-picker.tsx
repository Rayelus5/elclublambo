"use client";

import { useId, useMemo, useRef, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import { AssetLogo } from "@/components/economy/asset-logo";
import { rankAssets, type Asset, type AssetBalances, type AssetId } from "@/lib/economy/assets";
import { NETWORKS } from "@/lib/economy/networks";
import { formatAmount } from "@/lib/payments/amounts";
import { cn } from "@/lib/utils";

/** Shown decimals in the picker (ETH has 18): enough to compare, short enough for a 375 px row. */
const SHOWN_DECIMALS = 6;

/** "12,5"; ETH cut (not rounded) to 6 decimals, and "< 0,000001" for a positive dust balance. */
function balanceText(units: bigint, a: Asset): string {
  const full = formatAmount(units, a.token);
  const [whole, frac = ""] = full.split(",");
  if (frac.length <= SHOWN_DECIMALS) return full;
  const cut = frac.slice(0, SHOWN_DECIMALS).replace(/0+$/, "");
  if (whole === "0" && cut === "") return `< 0,${"0".repeat(SHOWN_DECIMALS - 1)}1`;
  return cut ? `${whole},${cut}` : whole!;
}

const NEXT_KEYS: Record<string, 1 | -1> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

/**
 * The payer picks a token (not a network): one radio row per asset, best payable first (rankAssets). A row without
 * balance stays selectable so the form can explain why it cannot pay. Arrow keys move and select (radiogroup pattern).
 */
export function AssetPicker({
  assets,
  balances,
  amount,
  value,
  onChange,
  label = "Moneda",
  balanceLabel = "Saldo: ",
  unknownLabel = "desconocido",
  arbitrumNote = "En Arbitrum solo vale USDC nativo (no USDC.e).",
}: {
  assets: readonly Asset[];
  balances: AssetBalances;
  amount: bigint | null;
  value: AssetId | null;
  onChange(id: AssetId): void;
  label?: string;
  /** Localized copy (the public pages are bilingual); the club keeps the Spanish defaults. */
  balanceLabel?: string;
  unknownLabel?: string;
  arbitrumNote?: string;
}) {
  const labelId = useId();
  const ranked = useMemo(() => rankAssets(assets, balances, amount), [assets, balances, amount]);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const checkedIndex = ranked.findIndex((a) => a.id === value);
  const tabStop = checkedIndex === -1 ? 0 : checkedIndex;
  const arbitrumUsdc = assets.some((a) => a.token === "USDC" && NETWORKS[a.chainId].key === "arbitrum");

  const onKeyDown = (e: KeyboardEvent, i: number) => {
    // Modified keys belong to the browser and assistive tech (history, screen reader commands).
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const step = NEXT_KEYS[e.key];
    const target = step ? (i + step + ranked.length) % ranked.length : e.key === "Home" ? 0 : e.key === "End" ? ranked.length - 1 : -1;
    if (target === -1) return;
    e.preventDefault();
    onChange(ranked[target]!.id);
    refs.current[target]?.focus();
  };

  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-sm font-bold text-fg">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-col gap-1">
        {ranked.map((a, i) => {
          const checked = a.id === value;
          const bal = balances[a.id];
          const known = bal !== null && bal !== undefined;
          return (
            <button
              key={a.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={i === tabStop ? 0 : -1}
              onClick={() => onChange(a.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                "flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-control border px-3 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none",
                checked ? "border-accent bg-surface-2" : "border-border hover:border-border-strong hover:bg-surface-2",
              )}
            >
              <span aria-hidden className="inline-flex">
                <AssetLogo token={a.token} chainId={a.chainId} size={28} />
              </span>
              <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-bold text-fg">{a.token}</span>
                <span className="text-xs text-fg-muted">{NETWORKS[a.chainId].name}</span>
              </span>
              <span className={cn("shrink-0 text-xs tabular-nums", known && bal > 0n ? "text-fg" : "text-fg-muted")}>
                {balanceLabel}
                {known ? (
                  balanceText(bal, a)
                ) : (
                  <>
                    <span aria-hidden>—</span>
                    <span className="sr-only">{unknownLabel}</span>
                  </>
                )}
              </span>
              <Check aria-hidden className={cn("size-4 shrink-0 text-accent", checked ? "visible" : "invisible")} />
            </button>
          );
        })}
      </div>
      {arbitrumUsdc ? <p className="text-xs text-fg-muted">{arbitrumNote}</p> : null}
    </div>
  );
}
