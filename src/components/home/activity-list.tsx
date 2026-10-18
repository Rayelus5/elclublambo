"use client";

import Link from "next/link";
import { Coins, Landmark, Target } from "lucide-react";
import { relativeTime } from "@/components/payments/tip-list";
import { messageHref, type ActivityItem } from "@/lib/home/queries";
import { formatAmount } from "@/lib/payments/amounts";

const ICON = { tip: Coins, donation: Landmark, bounty: Target } as const;

function sentence(i: ActivityItem): string {
  const amount = `${formatAmount(i.amount, i.token)} ${i.token}`;
  if (i.kind === "tip") return `${i.actorLabel} dio ${amount} a ${i.targetLabel ?? "un miembro"}`;
  if (i.kind === "donation") return `${i.actorLabel} donó ${amount} a la DAO`;
  return `${i.actorLabel} abrió un bounty de ${amount}`;
}

function href(i: ActivityItem): string {
  if (i.kind === "donation") return "/dao";
  if (i.channelId && i.messageId) return messageHref(i.channelId, i.messageId);
  return i.targetWallet ? `/u/${i.targetWallet}` : "/";
}

/** Club activity (tips, donations, new bounties), newest first. Names are already masked by the server. */
export function ActivityList({ items, empty = "Todavía no hay actividad." }: { items: readonly ActivityItem[]; empty?: string }) {
  if (items.length === 0) return <p className="text-sm text-fg-muted">{empty}</p>;
  return (
    <ul aria-label="Actividad del club" className="flex flex-col">
      {items.map((i, n) => {
        const Icon = ICON[i.kind];
        return (
          <li key={`${i.kind}-${i.at}-${n}`}>
            <Link
              href={href(i)}
              className="flex min-h-11 items-start gap-3 rounded-control px-2 py-2 text-sm outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
              <span className="min-w-0 flex-1 break-words text-fg">{sentence(i)}</span>
              <time dateTime={i.at} suppressHydrationWarning className="shrink-0 text-[13px] text-fg-muted">
                {relativeTime(i.at)}
              </time>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
