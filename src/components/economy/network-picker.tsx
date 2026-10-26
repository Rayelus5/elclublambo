"use client";

import { useId, useRef, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import { NetworkLogo } from "@/components/economy/network-logo";
import type { ChainId } from "@/lib/economy/networks";
import { cn } from "@/lib/utils";

const NEXT_KEYS: Record<string, 1 | -1> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

/**
 * Picks one network: a radiogroup of rows with the logo and the name (the pattern of AssetPicker). Arrow keys move and
 * select; Home/End jump. The chains come in the order the caller wants them shown. `disabled`: the choice is locked
 * (shown dimmed, `aria-disabled`, still focusable so a screen reader can tell why nothing changes).
 */
export function NetworkPicker({
  value,
  onChange,
  chains,
  label,
  disabled = false,
}: {
  value: ChainId;
  onChange(chain: ChainId): void;
  chains: readonly ChainId[];
  label: string;
  disabled?: boolean;
}) {
  const labelId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const checkedIndex = chains.indexOf(value);
  const tabStop = checkedIndex === -1 ? 0 : checkedIndex;

  const onKeyDown = (e: KeyboardEvent, i: number) => {
    // Modified keys belong to the browser and assistive tech (history, screen reader commands).
    if (e.altKey || e.ctrlKey || e.metaKey || disabled) return;
    const step = NEXT_KEYS[e.key];
    const target = step ? (i + step + chains.length) % chains.length : e.key === "Home" ? 0 : e.key === "End" ? chains.length - 1 : -1;
    if (target === -1) return;
    e.preventDefault();
    onChange(chains[target]!);
    refs.current[target]?.focus();
  };

  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-sm font-bold text-fg">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={labelId} aria-disabled={disabled || undefined} className="grid gap-1 sm:grid-cols-2">
        {chains.map((c, i) => {
          const checked = c === value;
          return (
            <button
              key={c}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-disabled={disabled || undefined}
              tabIndex={i === tabStop ? 0 : -1}
              onClick={() => {
                if (!disabled) onChange(c);
              }}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                "flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-control border px-3 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none",
                checked ? "border-accent bg-surface-2" : "border-border hover:border-border-strong hover:bg-surface-2",
                disabled && "cursor-not-allowed opacity-60 hover:border-border hover:bg-transparent",
              )}
            >
              <NetworkLogo chainId={c} size={24} withName className="min-w-0 flex-1 text-sm" />
              <Check aria-hidden className={cn("size-4 shrink-0 text-accent", checked ? "visible" : "invisible")} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
