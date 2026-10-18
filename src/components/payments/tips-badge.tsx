"use client";

import { Coins } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { TipsPopover } from "@/components/payments/tips-popover";
import { formatAmount } from "@/lib/payments/amounts";
import type { TipTotal } from "@/lib/payments/queries";

const ORDER = { USDC: 0, ETH: 1 } as const;

/** "Recompensado · 12,5 USDC · 0,001 ETH" under a tipped message; opens the donor list. Tokens are shown USDC first, then ETH. */
export function TipsBadge({ messageId, totals }: { messageId: string; totals: readonly TipTotal[] }) {
  if (totals.length === 0) return null;
  const label = ["Recompensado", ...totals.toSorted((a, b) => ORDER[a.token] - ORDER[b.token]).map((t) => `${formatAmount(t.total, t.token)} ${t.token}`)].join(" · ");
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className="inline-flex min-h-11 max-w-full items-center gap-1.5 self-start rounded-control px-2 text-[13px] text-fg-muted outline-none hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-surface-2"
        >
          <Coins aria-hidden className="size-4 shrink-0 text-accent" />
          <span className="min-w-0 break-words text-left">{label}</span>
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          collisionPadding={12}
          className="z-50 w-[min(24rem,calc(100vw-1.5rem))] rounded-panel border border-border-strong bg-surface p-3 text-fg outline-none"
        >
          <TipsPopover messageId={messageId} />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
