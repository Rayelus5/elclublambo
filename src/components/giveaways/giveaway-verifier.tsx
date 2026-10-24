"use client";

import { useRef, useState } from "react";
import { CircleCheck, CircleX, Loader2, ShieldCheck } from "lucide-react";
import type { Hex } from "viem";
import { Button } from "@/components/ui/button";
import { fetchBeacon } from "@/lib/giveaways/drand";
import { verifyGiveaway } from "@/lib/giveaways/draw";

type Step = { ok: boolean; title: string; detail: string };
type State = { kind: "idle" } | { kind: "checking" } | { kind: "unavailable" } | { kind: "done"; steps: Step[] };

const UNAVAILABLE = "No se pudo descargar la ronda. Inténtalo más tarde.";

const positions = (list: readonly number[]) => (list.length ? list.join(", ") : "ninguna");

/**
 * The public verifier, in the browser: downloads the drand round (fetchBeacon verifies its BLS signature), then checks
 * the revealed seed against the published commit, the round against the stored randomness, and recomputes the winners.
 * drand unreachable is never a ✗: it says so and asks to retry (Review Focus 5).
 */
export function GiveawayVerifier({
  commit,
  seedReveal,
  targetRound,
  drandRandomness,
  entryCount,
  winnerPositions,
}: {
  commit: string;
  seedReveal: string;
  /** The drand round as decimal text (bigint does not cross to the client as is). */
  targetRound: string;
  drandRandomness: string | null;
  entryCount: number;
  /** One per prize, by rank: the winning entry position, or null for a prize left without entries. */
  winnerPositions: readonly (number | null)[];
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const busy = useRef(false);
  const round = BigInt(targetRound);

  async function check() {
    if (busy.current) return;
    busy.current = true;
    setState({ kind: "checking" });
    try {
      const beacon = await fetchBeacon(round);
      if (beacon.status === "unavailable") return setState({ kind: "unavailable" });
      const signature = beacon.status === "ok" ? beacon.signature : "";
      const r = verifyGiveaway({
        commit,
        seedReveal: seedReveal as Hex,
        round,
        signature,
        randomness: drandRandomness,
        entryCount,
        winnerPositions,
      });
      const claimed = winnerPositions.filter((w): w is number => w !== null);
      const beaconOk = beacon.status === "ok" && r.beaconOk;
      setState({
        kind: "done",
        steps: [
          {
            ok: r.commitOk,
            title: "Huella de la semilla",
            detail: r.commitOk ? "La semilla revelada da la huella publicada antes de empezar." : "La semilla revelada no da la huella publicada.",
          },
          {
            ok: beaconOk,
            title: `Ronda ${targetRound} de drand`,
            detail: beaconOk
              ? "La firma de drand es válida y coincide con la usada en el sorteo."
              : beacon.status === "invalid"
                ? "La ronda descargada no tiene una firma válida de drand."
                : "La ronda de drand no coincide con la usada en el sorteo.",
          },
          {
            ok: beaconOk && r.winnersOk,
            title: "Ganadores",
            detail:
              beaconOk && r.winnersOk
                ? `Los ganadores coinciden: posiciones ${positions(r.winners)}.`
                : beaconOk
                  ? `Los ganadores no coinciden: salen las posiciones ${positions(r.winners)} y se publicaron ${positions(claimed)}.`
                  : "Sin una ronda válida no se pueden recalcular los ganadores.",
          },
        ],
      });
    } catch {
      setState({ kind: "unavailable" });
    } finally {
      busy.current = false;
    }
  }

  const checking = state.kind === "checking";
  return (
    <div className="flex flex-col gap-3">
      <Button type="button" variant="outline" className="self-start" onClick={check} disabled={checking}>
        {checking ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : <ShieldCheck aria-hidden />}
        {checking ? "Comprobando…" : "Comprobar"}
      </Button>
      <div aria-live="polite" className="flex flex-col gap-2">
        {state.kind === "unavailable" ? <p className="text-sm text-fg-muted">{UNAVAILABLE}</p> : null}
        {state.kind === "done" ? (
          <ol aria-label="Resultado de la comprobación" className="flex flex-col gap-2">
            {state.steps.map((s) => (
              <li key={s.title} className="flex items-start gap-2 text-sm">
                {s.ok ? (
                  <CircleCheck role="img" aria-label="Correcto" className="mt-0.5 size-5 shrink-0 text-success" />
                ) : (
                  <CircleX role="img" aria-label="No coincide" className="mt-0.5 size-5 shrink-0 text-danger" />
                )}
                <span className="flex min-w-0 flex-col">
                  <span className="font-bold">{s.title}</span>
                  <span className="text-fg-muted break-words">{s.detail}</span>
                </span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}
