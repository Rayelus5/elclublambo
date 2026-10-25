import { clubPath } from "@/lib/club/paths";
import Link from "next/link";
import { PartyPopper, Users } from "lucide-react";
import { Countdown } from "@/components/giveaways/countdown";
import { JoinButton } from "@/components/giveaways/join-button";
import { PrizeLabel } from "@/components/giveaways/prize-status";
import { formatClose, participants, STATUS_LABEL } from "@/lib/giveaways/format";
import type { GiveawayCard as Card } from "@/lib/giveaways/types";
import { cn } from "@/lib/utils";

/** One giveaway in /sorteos: prizes, countdown or outcome, and «Participar» / «Salir» while open. */
export function GiveawayCard({ giveaway: g }: { giveaway: Card }) {
  const open = g.status === "open";
  const ended = g.status === "drawn" || g.status === "void" || g.status === "cancelled";
  const iWon = g.winners.some((w) => w.iWon);
  const winnerOf = new Map(g.winners.map((w) => [w.rank, w]));
  const titleId = `giveaway-${g.id}`;

  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h3 id={titleId} className="min-w-0 text-base font-bold break-words">
          <Link
            href={clubPath(`/sorteos/${g.id}`)}
            className="rounded-control underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            {g.title}
          </Link>
        </h3>
        {open ? null : (
          <span className={cn("rounded-control border px-2 py-0.5 text-[13px] font-bold", g.status === "drawn" ? "border-accent text-accent" : "border-border-strong text-fg-muted")}>
            {STATUS_LABEL[g.status]}
          </span>
        )}
      </header>

      <ol aria-label="Premios" className="flex flex-col gap-2">
        {g.prizes.map((p) => {
          const w = winnerOf.get(p.rank);
          return (
            <li key={p.rank} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="w-5 shrink-0 font-mono text-[13px] text-fg-muted tabular-nums">{`${p.rank}.`}</span>
              <PrizeLabel prize={p} />
              {w ? <span className="text-fg-muted">{w.label ?? "Anónimo"}</span> : null}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-fg-muted">
        {open ? (
          <Countdown closesAt={g.closesAt} className="font-mono font-bold text-fg tabular-nums" />
        ) : ended ? (
          <span suppressHydrationWarning>{`Cerró el ${formatClose(g.closesAt)}`}</span>
        ) : null}
        <span className="inline-flex items-center gap-1.5">
          <Users aria-hidden className="size-3.5" />
          {participants(g.entryCount)}
        </span>
      </div>

      {iWon ? (
        <p className="inline-flex items-center gap-2 self-start text-sm font-bold text-success">
          <PartyPopper aria-hidden className="size-4" />
          Has ganado
        </p>
      ) : null}

      {open ? <JoinButton id={g.id} entered={g.iEntered} closesAt={g.closesAt} /> : null}
    </article>
  );
}
