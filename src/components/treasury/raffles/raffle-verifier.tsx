"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Hex } from "viem";
import { Button } from "@/components/ui/button";
import { verifyDraw } from "@/lib/treasury/raffle-draw";
import { fetchDrawBlocks } from "@/lib/treasury/raffle-verify-chain";
import type { RaffleDetail } from "@/lib/treasury/raffles";

const HEX32 = /^0x[0-9a-fA-F]{64}$/;

type Check = { ok: boolean; text: string };
type Outcome =
  | { kind: "invalid" }
  | {
      kind: "done";
      /** The first failing statement of the maths (commit, then winner), null when both hold. */
      mismatch: string | null;
      verdict: string;
      r: bigint | null;
      checks: Check[];
      chainUnavailable: boolean;
    };

/** The inputs the maths needs, or null when anything published is malformed. */
function readInputs(d: RaffleDetail): { seed: Hex; commit: Hex; blockHash: Hex; weights: bigint[] } | null {
  if (!d.seedReveal || !HEX32.test(d.seedReveal) || !HEX32.test(d.commit)) return null;
  const weights: bigint[] = [];
  for (const [i, e] of d.entryList.entries()) {
    if (e.position !== i + 1 || e.weight === null || e.weight < 0n) return null;
    weights.push(e.weight);
  }
  const total = weights.reduce((a, w) => a + w, 0n);
  if (d.totalWeight !== null && d.totalWeight !== total) return null;
  if (d.drawBlockHash !== null && !HEX32.test(d.drawBlockHash)) return null;
  // A draw with weight needs its block hash; a void one (nobody with weight) is decided by the weights alone.
  if (total > 0n && d.drawBlockHash === null) return null;
  return {
    seed: d.seedReveal as Hex,
    commit: d.commit as Hex,
    blockHash: (d.drawBlockHash ?? `0x${"00".repeat(32)}`) as Hex,
    weights,
  };
}

const ms = (iso: string | null): number | null => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : t;
};

/**
 * Recomputes the draw in the visitor's own browser: keccak256(seed) against the commitment, then the winner from the
 * seed, the block hash and the weights; and the draw block itself against the chain (hash, time, first after the close).
 * The maths come from raffle-draw.ts, the TS mirror pinned to the SQL by a shared fixture.
 */
export function RaffleVerifier({ detail: d }: { detail: RaffleDetail }) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  if (!d.seedReveal) {
    return (
      <p className="text-sm text-fg-muted">
        {d.status === "cancelled" ? "Este sorteo se canceló: no hubo sorteo que comprobar." : "La semilla se publicará al resolver el sorteo."}
      </p>
    );
  }

  async function run() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const input = readInputs(d);
      if (!input) return setOutcome({ kind: "invalid" });
      let check;
      try {
        check = verifyDraw({
          commit: input.commit,
          seed: input.seed,
          blockHash: input.blockHash,
          weights: input.weights,
          winnerPosition: d.winnerPosition,
        });
      } catch {
        return setOutcome({ kind: "invalid" });
      }
      const voidDraw = check.total === 0n;

      let mismatch: string | null = null;
      if (!check.commitOk) mismatch = "No coincide: la semilla no corresponde al compromiso.";
      else if (!check.winnerOk) {
        mismatch =
          check.position === null
            ? "No coincide: con esos pesos no hay ganador."
            : `No coincide: el ganador calculado es la participación #${check.position}.`;
      }

      const checks: Check[] = [];
      let chainUnavailable = false;
      if (d.drawBlockNumber !== null && d.drawBlockHash !== null) {
        try {
          const chain = await fetchDrawBlocks(d.chainId, d.drawBlockNumber);
          const n = d.drawBlockNumber.toString();
          const hashOk = chain.hash.toLowerCase() === d.drawBlockHash.toLowerCase();
          checks.push({
            ok: hashOk,
            text: hashOk ? `El hash del bloque ${n} coincide con el de la red.` : `El hash del bloque ${n} no coincide con el de la red.`,
          });
          const stored = ms(d.drawBlockTime);
          const timeOk = stored !== null && stored === Number(chain.timestamp) * 1000;
          checks.push({
            ok: timeOk,
            text: timeOk ? "La hora del bloque coincide con la guardada." : "La hora del bloque no coincide con la guardada.",
          });
          const closes = ms(d.closesAt);
          const firstOk = closes !== null && Number(chain.parentTimestamp) * 1000 <= closes && closes < Number(chain.timestamp) * 1000;
          checks.push({
            ok: firstOk,
            text: firstOk
              ? `El bloque ${n} es el primer bloque posterior al cierre.`
              : `El bloque ${n} no es el primer bloque posterior al cierre.`,
          });
        } catch {
          chainUnavailable = true;
        }
      }

      const chainBad = checks.some((c) => !c.ok);
      if (!mismatch && chainBad) mismatch = "No coincide: el bloque del sorteo no coincide con la red.";
      setOutcome({
        kind: "done",
        mismatch,
        verdict: voidDraw
          ? "Comprobado: nadie tenía peso, así que no hay ganador."
          : `Comprobado: el compromiso coincide y gana la participación #${check.position}.`,
        r: voidDraw ? null : check.r,
        checks,
        chainUnavailable,
      });
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button type="button" variant="outline" onClick={run} disabled={pending} aria-busy={pending}>
          {pending ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          Comprobar en este navegador
        </Button>
      </div>
      <div aria-live="polite" className="flex flex-col gap-2 text-sm">
        {outcome?.kind === "invalid" ? (
          <p role="alert" className="text-danger">
            Datos no válidos: no se puede comprobar este sorteo con lo publicado.
          </p>
        ) : null}
        {outcome?.kind === "done" ? (
          <>
            {outcome.mismatch ? (
              <p role="alert" className="font-bold text-danger">
                {outcome.mismatch}
              </p>
            ) : (
              <>
                <p className="font-bold text-success">{outcome.verdict}</p>
                {outcome.r !== null ? <p className="font-mono text-[13px]">{`r = ${outcome.r}`}</p> : null}
              </>
            )}
            {outcome.checks.length > 0 ? (
              <ul aria-label="Comprobaciones" className="flex flex-col gap-1">
                {outcome.checks.map((c) => (
                  <li key={c.text} className={c.ok ? "text-fg" : "text-danger"}>
                    <span aria-hidden className="mr-2 font-bold">
                      {c.ok ? "✓" : "✗"}
                    </span>
                    {c.text}
                  </li>
                ))}
              </ul>
            ) : null}
            {outcome.chainUnavailable ? (
              <p className="text-fg-muted">No se pudo consultar la red: el bloque del sorteo queda sin comprobar. Inténtalo de nuevo más tarde.</p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
