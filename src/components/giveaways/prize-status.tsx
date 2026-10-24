import { CircleCheck, CircleDashed, CircleSlash, Clock, Coins, ExternalLink, Gift, Shield, type LucideIcon } from "lucide-react";
import { NetworkLogo } from "@/components/economy/network-logo";
import { explorerTx, isChainId } from "@/lib/economy/networks";
import type { GiveawayPrize, GiveawayPrizeState, UnawardedReason } from "@/lib/giveaways/types";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<GiveawayPrize["kind"], LucideIcon> = { crypto: Coins, role: Shield, custom: Gift };
const KIND_NAME: Record<GiveawayPrize["kind"], string> = { crypto: "USDC", role: "Rol", custom: "Otro" };

/** A prize as one line: kind icon, label and, for USDC, its network. */
export function PrizeLabel({ prize, className }: { prize: GiveawayPrize; className?: string }) {
  const Icon = KIND_ICON[prize.kind];
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <Icon aria-hidden className="size-4 shrink-0 text-fg-muted" />
      <span className="sr-only">{`${KIND_NAME[prize.kind]}: `}</span>
      <span className="min-w-0 font-bold break-words">{prize.label}</span>
      {prize.kind === "crypto" && isChainId(prize.chainId) ? <NetworkLogo chainId={prize.chainId} size={16} /> : null}
    </span>
  );
}

const UNAWARDED_NOTE: Record<UnawardedReason, string> = {
  not_enough_entries: "No hubo participantes suficientes.",
  role_unavailable: "El rol ya no se podía sortear.",
  winner_inactive: "El ganador ya no es miembro.",
};

type Tone = "muted" | "warning" | "success";
type View = { text: string; tone: Tone; Icon: LucideIcon; note?: string };

function view(p: GiveawayPrizeState): View {
  switch (p.status) {
    case "pending":
      return { text: "Por sortear", tone: "muted", Icon: CircleDashed };
    case "awarded":
      return p.kind === "crypto"
        ? { text: "Pendiente de pago", tone: "warning", Icon: Clock }
        : { text: "Pendiente de entrega", tone: "warning", Icon: Clock };
    case "paid":
      return { text: "Pagado", tone: "success", Icon: CircleCheck };
    case "delivered":
      return p.kind === "role" ? { text: "Rol asignado", tone: "success", Icon: CircleCheck } : { text: "Entregado", tone: "success", Icon: CircleCheck };
    case "unawarded":
      return {
        text: "Sin ganador",
        tone: "muted",
        Icon: CircleSlash,
        note: UNAWARDED_NOTE[p.unawardedReason ?? "not_enough_entries"],
      };
  }
}

const TONE: Record<Tone, string> = {
  muted: "border-border-strong text-fg-muted",
  warning: "border-warning text-warning",
  success: "border-success text-success",
};

/** The state of one prize after (or before) the draw: icon + text, never colour alone. */
export function PrizeStatus({ prize: p }: { prize: GiveawayPrizeState }) {
  const v = view(p);
  const chain = isChainId(p.chainId) ? p.chainId : null;
  return (
    <span className="flex flex-col items-start gap-1">
      <span className={cn("inline-flex items-center gap-1.5 rounded-control border px-2 py-0.5 text-[13px] font-bold", TONE[v.tone])}>
        <v.Icon aria-hidden className="size-3.5 shrink-0" />
        {v.text}
      </span>
      {v.note ? <span className="text-[13px] text-fg-muted">{v.note}</span> : null}
      {p.status === "paid" && p.payoutTxHash && chain !== null ? (
        <a
          href={explorerTx(chain, p.payoutTxHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1 rounded-control text-[13px] font-bold text-accent underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
        >
          Ver transacción
          <ExternalLink aria-hidden className="size-3.5" />
          <span className="sr-only">(se abre en otra pestaña)</span>
        </a>
      ) : null}
    </span>
  );
}
