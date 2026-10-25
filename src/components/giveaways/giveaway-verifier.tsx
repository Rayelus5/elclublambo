"use client";

import { useRef, useState } from "react";
import { CircleCheck, CircleX, Loader2, ShieldCheck } from "lucide-react";
import type { Hex } from "viem";
import { Button } from "@/components/ui/button";
import { fetchBeacon } from "@/lib/giveaways/drand";
import { verifyGiveaway } from "@/lib/giveaways/draw";
import type { Dictionary } from "@/lib/i18n";
import { es } from "@/lib/i18n/dictionaries/es";
import { fill } from "@/lib/i18n/fill";

type Step = { ok: boolean; title: string; detail: string };
type State = { kind: "idle" } | { kind: "checking" } | { kind: "unavailable" } | { kind: "done"; steps: Step[] };

export type VerifierLabels = Dictionary["giveaways"]["detail"]["verifier"];

/** The club's Spanish copy: the public dictionary's verifier section in Spanish is the same text. */
const DEFAULT_LABELS: VerifierLabels = es.giveaways.detail.verifier;

/**
 * The public verifier, in the browser: downloads the drand round (fetchBeacon verifies its BLS signature), then checks
 * the revealed seed against the published commit, that the round is the first one after the close and matches the stored
 * randomness, and recomputes the winners.
 * drand unreachable is never a ✗: it says so and asks to retry (Review Focus 5).
 */
export function GiveawayVerifier({
  commit,
  seedReveal,
  targetRound,
  closesAt,
  drandRandomness,
  entryCount,
  winnerPositions,
  labels: l = DEFAULT_LABELS,
}: {
  commit: string;
  seedReveal: string;
  /** The drand round as decimal text (bigint does not cross to the client as is). */
  targetRound: string;
  /** ISO close time: the round must be the first drand round after it. */
  closesAt: string;
  drandRandomness: string | null;
  entryCount: number;
  /** One per prize, by rank: the winning entry position, or null for a prize left without entries. */
  winnerPositions: readonly (number | null)[];
  /** Copy from the public dictionary; without it, the club's Spanish texts. */
  labels?: VerifierLabels;
}) {
  const positions = (list: readonly number[]) => (list.length ? list.join(", ") : l.none);
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
        closesAt,
      });
      const claimed = winnerPositions.filter((w): w is number => w !== null);
      const beaconOk = beacon.status === "ok" && r.beaconOk;
      const drandOk = beaconOk && r.roundOk;
      setState({
        kind: "done",
        steps: [
          {
            ok: r.commitOk,
            title: l.commitTitle,
            detail: r.commitOk ? l.commitOk : l.commitBad,
          },
          {
            ok: drandOk,
            title: fill(l.roundTitle, { round: targetRound }),
            detail: drandOk ? l.roundOk : !r.roundOk ? l.roundNotFirst : beacon.status === "invalid" ? l.roundBadSignature : l.roundMismatch,
          },
          {
            ok: beaconOk && r.winnersOk,
            title: l.winnersTitle,
            detail:
              beaconOk && r.winnersOk
                ? fill(l.winnersOk, { list: positions(r.winners) })
                : beaconOk
                  ? fill(l.winnersBad, { list: positions(r.winners), claimed: positions(claimed) })
                  : l.winnersNoBeacon,
          },
        ],
      });
    } catch (e) {
      // Not expected (fetchBeacon and verifyGiveaway never throw): logged for diagnosis, and shown like drand being
      // unreachable, never as a ✗ the giveaway did not earn.
      console.error("[giveaways] verifier failed", e);
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
        {checking ? l.checking : l.check}
      </Button>
      <div aria-live="polite" className="flex flex-col gap-2">
        {state.kind === "unavailable" ? <p className="text-sm text-fg-muted">{l.unavailable}</p> : null}
        {state.kind === "done" ? (
          <ol aria-label={l.result} className="flex flex-col gap-2">
            {state.steps.map((s) => (
              <li key={s.title} className="flex items-start gap-2 text-sm">
                {s.ok ? (
                  <CircleCheck role="img" aria-label={l.ok} className="mt-0.5 size-5 shrink-0 text-success" />
                ) : (
                  <CircleX role="img" aria-label={l.bad} className="mt-0.5 size-5 shrink-0 text-danger" />
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
