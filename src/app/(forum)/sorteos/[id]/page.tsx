import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, PartyPopper, Users } from "lucide-react";
import { Countdown } from "@/components/giveaways/countdown";
import { GiveawayVerifier } from "@/components/giveaways/giveaway-verifier";
import { JoinButton } from "@/components/giveaways/join-button";
import { PrizeList } from "@/components/giveaways/prize-list";
import { CancelGiveawayButton, DrawNowButton } from "@/components/giveaways/treasurer-actions";
import { PageLoader } from "@/components/shell/page-loader";
import { formatClose, isWin, participants, STATUS_LABEL } from "@/lib/giveaways/format";
import { getGiveaway } from "@/lib/giveaways/queries";
import { createServerClient } from "@/lib/supabase/server";
import { treasurerId } from "@/lib/treasury/treasurer";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Sorteo" };

type Params = Promise<{ id: string }>;

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} id={id} className="flex scroll-mt-20 flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-title`} className="text-h2">
          {title}
        </h2>
        {intro ? <p className="text-[13px] text-fg-muted">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Hash({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[13px] font-bold text-fg-muted">{label}</dt>
      <dd className="font-mono text-[13px] break-all">{value}</dd>
    </div>
  );
}

// Reads cookies (dynamic): under cacheComponents it must live inside a Suspense.
async function GiveawayContent({ params }: { params: Params }) {
  const { id } = await params;
  const supabase = await createServerClient();
  const [g, treasurerMember] = await Promise.all([getGiveaway(supabase, id), treasurerId().catch(() => null)]);
  if (!g) notFound();
  const treasurer = treasurerMember !== null;
  const open = g.status === "open";
  const live = open || g.status === "closed";
  const iWon = g.prizeStates.some(isWin);
  const round = g.targetRound.toString();

  return (
    <div className="flex w-full flex-col gap-6">
      <Link
        href="/sorteos"
        className="inline-flex min-h-11 items-center gap-2 self-start rounded-control text-sm font-bold text-fg-muted outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Sorteos
      </Link>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <h1 className="min-w-0 text-h1 break-words">{g.title}</h1>
          <span className={cn("mt-2 rounded-control border px-2 py-0.5 text-[13px] font-bold", g.status === "drawn" ? "border-accent text-accent" : "border-border-strong text-fg-muted")}>
            {STATUS_LABEL[g.status]}
          </span>
        </div>
        {g.description ? <p className="max-w-2xl break-words whitespace-pre-line text-fg-muted">{g.description}</p> : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted">
          {open ? (
            <Countdown closesAt={g.closesAt} className="font-mono font-bold text-fg tabular-nums" />
          ) : (
            <span suppressHydrationWarning>{`Cerró el ${formatClose(g.closesAt)}`}</span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <Users aria-hidden className="size-4" />
            {participants(g.entryCount)}
          </span>
        </div>
        {iWon ? (
          <p className="inline-flex items-center gap-2 self-start font-bold text-success">
            <PartyPopper aria-hidden className="size-4" />
            Has ganado
          </p>
        ) : null}
        {g.status === "cancelled" ? <p className="text-sm">{`Cancelado: ${g.cancelReason ?? "sin motivo"}`}</p> : null}
        {g.status === "void" ? <p className="text-sm">Nadie participó: el sorteo terminó sin ganadores. La semilla se ha revelado igualmente.</p> : null}
        {open ? <JoinButton id={g.id} entered={g.iEntered} closesAt={g.closesAt} /> : null}
        <p className="text-[13px] text-fg-muted">Gratis: nunca se paga por participar. Todos tienen la misma probabilidad.</p>
      </header>

      {treasurer && live ? (
        <Section id="tesorero" title="Panel del tesorero" intro="«Sortear ahora» funciona en cuanto existe la ronda de drand; si no, lo hace el cron.">
          <div className="flex flex-wrap items-start gap-3">
            <DrawNowButton id={g.id} />
            <CancelGiveawayButton id={g.id} />
          </div>
        </Section>
      ) : null}

      <Section id="premios" title="Premios" intro="Se sortean en orden. Cada persona gana como mucho un premio.">
        <PrizeList prizes={g.prizeStates} treasurer={treasurer} />
      </Section>

      <Section id="como-se-comprueba" title="Cómo se comprueba">
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
          <li>Antes de empezar publicamos la huella de una semilla secreta.</li>
          <li>{`El azar sale de drand, una red pública: la ronda ${round}, emitida justo después del cierre.`}</li>
          <li>Con la semilla y esa ronda cualquiera recalcula los ganadores.</li>
        </ol>
        <dl className="grid gap-3">
          <Hash label="Huella (keccak256 de la semilla)" value={g.commit} />
          <Hash label="Ronda de drand" value={round} />
          <Hash label="Semilla" value={g.seedReveal ?? "Se revela al sortear."} />
          {g.drandRandomness ? <Hash label="Azar de la ronda (sha256 de la firma)" value={g.drandRandomness} /> : null}
        </dl>
        {g.status === "drawn" && g.seedReveal ? (
          <GiveawayVerifier
            commit={g.commit}
            seedReveal={g.seedReveal}
            targetRound={round}
            drandRandomness={g.drandRandomness}
            entryCount={g.entryCount}
            winnerPositions={g.prizeStates.map((p) => p.winnerPosition)}
          />
        ) : null}
      </Section>

      <Section id="participantes" title="Participantes" intro={live ? "Al cerrar, cada participante recibe una posición por orden de entrada." : undefined}>
        {g.entries.length === 0 ? (
          <p className="text-sm text-fg-muted">Nadie participa todavía.</p>
        ) : (
          <ol aria-label="Lista de participantes" className="grid gap-1 sm:grid-cols-2">
            {g.entries.map((e, i) => (
              <li key={`${e.position ?? "p"}-${i}`} className="flex min-w-0 items-center gap-3 text-sm">
                <span className="w-8 shrink-0 font-mono text-[13px] text-fg-muted tabular-nums">{e.position ?? "·"}</span>
                <span className="min-w-0 truncate">{e.label ?? "Anónimo"}</span>
                {e.isMe ? <span className="text-[13px] font-bold text-accent">Tú</span> : null}
              </li>
            ))}
          </ol>
        )}
      </Section>

      <p role="note" className="border-t border-border pt-4 text-[13px] text-fg-muted">
        ElClub. no custodia fondos: los premios en USDC los paga la Safe del club, que controlan sus firmantes.
      </p>
    </div>
  );
}

export default function GiveawayPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<PageLoader />}>
      <GiveawayContent params={params} />
    </Suspense>
  );
}
