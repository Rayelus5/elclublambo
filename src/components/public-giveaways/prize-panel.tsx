import { CircleCheck, CircleDashed, CircleSlash, Clock, Coins, ExternalLink, Gift, type LucideIcon } from "lucide-react";
import { NetworkLogo } from "@/components/economy/network-logo";
import { shortAddress } from "@/lib/auth/wallet";
import { explorerTx, isChainId, NETWORKS } from "@/lib/economy/networks";
import type { Dictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { fill } from "@/lib/i18n/fill";
import { formatAmount } from "@/lib/payments/amounts";
import type { PublicPrize } from "@/lib/public-giveaways/types";
import { cn } from "@/lib/utils";

type PrizeLabels = Dictionary["giveaways"]["detail"]["prizes"];

/** USDC base units as text -> "5,5" (es) / "5.5" (en); null when it is not an integer. */
export function usdcText(amount: string | null, lang: Lang): string | null {
  if (!amount || !/^\d+$/.test(amount)) return null;
  const text = formatAmount(BigInt(amount), "USDC");
  return lang === "en" ? text.replace(",", ".") : text;
}

/** "5 USDC" in the page's language for a USDC prize; the organizer's text for a custom one. */
export function prizeTitle(p: PublicPrize, lang: Lang): string {
  if (p.kind !== "crypto") return p.label;
  const amount = usdcText(p.amount, lang);
  return amount ? `${amount} USDC` : p.label;
}

type Tone = "muted" | "warning" | "success";
const TONE: Record<Tone, string> = {
  muted: "border-border-strong text-fg-muted",
  warning: "border-warning text-warning",
  success: "border-success text-success",
};

function state(p: PublicPrize, t: PrizeLabels): { text: string; tone: Tone; Icon: LucideIcon; note?: string } {
  switch (p.status) {
    case "pending":
      return { text: t.pending, tone: "muted", Icon: CircleDashed };
    case "awarded":
      return { text: p.kind === "crypto" ? t.awaitingPayment : t.awaitingDelivery, tone: "warning", Icon: Clock };
    case "paid":
      return { text: t.paid, tone: "success", Icon: CircleCheck };
    case "delivered":
      return { text: t.delivered, tone: "success", Icon: CircleCheck };
    case "unawarded":
      return { text: t.unawarded, tone: "muted", Icon: CircleSlash, note: t.notEnough };
  }
}

const WON = new Set(["awarded", "paid", "delivered"]);

/** The prizes by rank: what it is, who won it (position + short address) and its state, never colour alone. */
export function PrizePanel({ lang, prizes, viewerWallet, t }: { lang: Lang; prizes: readonly PublicPrize[]; viewerWallet: string | null; t: PrizeLabels }) {
  const me = viewerWallet?.toLowerCase() ?? null;
  return (
    <ol aria-label={t.listLabel} className="flex flex-col divide-y divide-border">
      {prizes.map((p) => {
        const s = state(p, t);
        const chain = p.kind === "crypto" && isChainId(p.chainId) ? p.chainId : null;
        const Icon = p.kind === "crypto" ? Coins : Gift;
        const mine = me !== null && p.winnerAddress?.toLowerCase() === me;
        return (
          <li key={p.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center gap-3">
                <span className="w-5 shrink-0 font-mono text-[13px] text-fg-muted tabular-nums">{`${p.rank}.`}</span>
                <Icon aria-hidden className="size-4 shrink-0 text-fg-muted" />
                <span className="min-w-0 font-bold break-words">{prizeTitle(p, lang)}</span>
              </div>
              <p className="flex items-center gap-1.5 pl-8 text-[13px] text-fg-muted">
                {chain !== null ? (
                  <>
                    <NetworkLogo chainId={chain} size={16} decorative />
                    {fill(t.usdcOn, { network: NETWORKS[chain].name })}
                  </>
                ) : (
                  t.custom
                )}
              </p>
              {WON.has(p.status) && p.winnerPosition !== null ? (
                <p className="pl-8 text-sm text-fg-muted">
                  {fill(t.winner, { n: p.winnerPosition })}
                  {p.winnerAddress ? (
                    <>
                      {" · "}
                      <span className="font-mono text-fg">{shortAddress(p.winnerAddress)}</span>
                    </>
                  ) : null}
                  {mine ? <strong className="ml-2 font-bold text-success">{t.you}</strong> : null}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col items-start gap-1 pl-8 sm:items-end sm:pl-0">
              <span className={cn("inline-flex items-center gap-1.5 rounded-control border px-2 py-0.5 text-[13px] font-bold", TONE[s.tone])}>
                <s.Icon aria-hidden className="size-3.5 shrink-0" />
                {s.text}
              </span>
              {s.note ? <span className="text-[13px] text-fg-muted">{s.note}</span> : null}
              {p.status === "paid" && p.payoutTxHash && chain !== null ? (
                <a
                  href={explorerTx(chain, p.payoutTxHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center gap-1 rounded-control text-[13px] font-bold text-accent underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {t.viewTx}
                  <ExternalLink aria-hidden className="size-3.5" />
                  <span className="sr-only">{t.newTab}</span>
                </a>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
