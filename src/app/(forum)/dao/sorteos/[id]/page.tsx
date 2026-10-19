import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CopyHashButton } from "@/components/treasury/raffles/copy-hash-button";
import { RaffleVerifier } from "@/components/treasury/raffles/raffle-verifier";
import { WEIGHTS_NOTE } from "@/components/treasury/raffles/raffle-notes";
import { DaoLive } from "@/components/treasury/dao-live";
import { explorerBlock, NETWORKS } from "@/lib/economy/networks";
import { createServerClient } from "@/lib/supabase/server";
import { formatParticipaciones } from "@/lib/treasury/format";
import { formatWhen } from "@/lib/treasury/panel";
import { formatPrize, getRaffleDetail, raffleStatusLabel } from "@/lib/treasury/raffles";

export const metadata: Metadata = { title: "Sorteo" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-fg-muted sm:w-36">{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

const linkClass =
  "inline-flex min-h-11 items-center rounded-control font-bold text-accent underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

// Reads cookies (dynamic): under cacheComponents it must live inside a Suspense. The id comes from the url, so it is
// checked before it reaches the database.
async function RaffleContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createServerClient();
  const d = await getRaffleDetail(supabase, id);
  if (!d) notFound();

  const totalText = d.totalWeight !== null ? d.totalWeight.toString() : "—";
  const weighted = d.mode === "weighted";
  const hidden = "text-fg-muted";

  return (
    <div className="flex w-full flex-col gap-8">
      <header className="flex flex-col gap-2">
        <Link href="/dao#sorteos" className={`${linkClass} self-start gap-1.5 text-sm`}>
          <ArrowLeft aria-hidden className="size-4" />
          Sorteos
        </Link>
        <h1 className="text-h1 break-words">{d.title}</h1>
        <p className="text-fg-muted">{raffleStatusLabel(d)}</p>
      </header>

      <DaoLive />

      <section aria-labelledby="datos-title" className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6">
        <h2 id="datos-title" className="text-h2">
          Datos del sorteo
        </h2>
        <dl className="flex flex-col gap-3 text-sm">
          <Row term="Premio">{formatPrize(d.prizeAmount, d.prizeToken)}</Row>
          <Row term="Red">{NETWORKS[d.chainId].name}</Row>
          <Row term="Cierre">{formatWhen(d.closesAt)}</Row>
          <Row term="Modo">{weighted ? "Ponderado por participación" : "Igualitario"}</Row>
          <Row term="Compromiso">
            <span className="flex items-center gap-2">
              <span className="min-w-0 font-mono text-[13px] break-all">{d.commit}</span>
              <CopyHashButton value={d.commit} label="Copiar compromiso" />
            </span>
          </Row>
          <Row term="Semilla">
            {d.seedReveal ? (
              <span className="font-mono text-[13px] break-all">{d.seedReveal}</span>
            ) : (
              <span className={hidden}>Se revela al resolver el sorteo</span>
            )}
          </Row>
          <Row term="Bloque">
            {d.drawBlockNumber !== null ? (
              <a href={explorerBlock(d.chainId, d.drawBlockNumber)} target="_blank" rel="noopener noreferrer" className={`${linkClass} font-mono`}>
                {d.drawBlockNumber.toString()}
              </a>
            ) : (
              <span className={hidden}>Aún sin bloque</span>
            )}
          </Row>
          <Row term="Hash del bloque">
            {d.drawBlockHash ? <span className="font-mono text-[13px] break-all">{d.drawBlockHash}</span> : <span className={hidden}>Aún sin bloque</span>}
          </Row>
          <Row term="Peso total">{d.totalWeight !== null ? totalText : <span className={hidden}>Se fija al cerrar</span>}</Row>
        </dl>
        {weighted ? <p className="text-[13px] text-fg-muted">{WEIGHTS_NOTE}</p> : null}
      </section>

      <section aria-labelledby="participantes-title" className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6">
        <h2 id="participantes-title" className="text-h2">
          Participantes
        </h2>
        {d.entryList.length === 0 ? (
          <p className="text-sm text-fg-muted">Todavía no se ha apuntado nadie.</p>
        ) : (
          <ol aria-label="Participantes" className="flex flex-col gap-1 text-sm">
            {d.entryList.map((e, i) => (
              <li key={e.position ?? i} className="break-words">
                {[
                  e.position !== null ? `#${e.position}` : null,
                  e.isMe ? `${e.label} (tú)` : e.label,
                  e.weight !== null ? `peso ${e.weight}${weighted ? ` (${formatParticipaciones(e.weight)})` : ""}` : null,
                ]
                  .filter((x): x is string => x !== null)
                  .join(" · ")}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="comprobar-title" className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6">
        <h2 id="comprobar-title" className="text-h2">
          Cómo comprobarlo
        </h2>
        <ol aria-label="Pasos para comprobarlo" className="flex list-decimal flex-col gap-2 pl-5 text-sm">
          <li>Comprueba que keccak256(semilla) coincide con el compromiso publicado al crear el sorteo.</li>
          <li>{`Abre el bloque ${d.drawBlockNumber !== null ? d.drawBlockNumber : "del sorteo"} en el explorador: es el primero con hora posterior al cierre. Copia su hash.`}</li>
          <li>Calcula keccak256(semilla seguida del hash del bloque, 64 bytes) y léelo como un número entero.</li>
          <li>{`Divide ese número entre el peso total (${d.totalWeight !== null ? totalText : "W"}) y quédate con el resto r.`}</li>
          <li>Recorre la lista en orden sumando pesos: gana el primero cuya suma supera r.</li>
        </ol>
        <RaffleVerifier detail={d} />
      </section>
    </div>
  );
}

export default function RafflePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="min-h-64" aria-hidden />}>
      <RaffleContent params={params} />
    </Suspense>
  );
}
