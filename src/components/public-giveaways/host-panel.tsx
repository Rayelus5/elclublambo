"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Loader2, PackageCheck, XCircle } from "lucide-react";
import { usePastClose } from "@/components/giveaways/countdown";
import { Button } from "@/components/ui/button";
import { shortAddress } from "@/lib/auth/wallet";
import { isChainId } from "@/lib/economy/networks";
import type { Dictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { fill } from "@/lib/i18n/fill";
import { cancelPublicGiveawayAction, markPublicPrizeDeliveredAction } from "@/lib/public-giveaways/actions";
import type { PublicGiveawayStatus, PublicPrize } from "@/lib/public-giveaways/types";
import { PastePaymentForm, PayPrizeButton } from "./pay-prize-button";
import { prizeTitle } from "./prize-panel";

type HostLabels = Dictionary["giveaways"]["detail"]["host"];
type Errors = Dictionary["giveaways"]["errors"];

function CancelGiveaway({ id, t, errors }: { id: string; t: HostLabels; errors: Errors }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function cancel() {
    setError(null);
    start(async () => {
      const r = await cancelPublicGiveawayAction(id);
      if (r.ok) router.refresh();
      else setError(errors[r.error] ?? errors.unknown);
    });
  }

  return (
    <div className="flex flex-col items-start gap-2">
      {confirming ? (
        <>
          <p className="text-sm font-bold">{t.cancelConfirm}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="destructive" disabled={pending} onClick={cancel}>
              {pending ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
              {pending ? t.cancelling : t.cancelYes}
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirming(false)}>
              {t.cancelNo}
            </Button>
          </div>
        </>
      ) : (
        <Button type="button" variant="outline" className="text-danger" onClick={() => setConfirming(true)}>
          <XCircle aria-hidden />
          {t.cancel}
        </Button>
      )}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function MarkDelivered({ prizeId, t, errors }: { prizeId: string; t: HostLabels; errors: Errors }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function mark() {
    setError(null);
    start(async () => {
      const r = await markPublicPrizeDeliveredAction(prizeId);
      if (r.ok) {
        setDone(true);
        router.refresh();
      } else setError(errors[r.error] ?? errors.unknown);
    });
  }

  if (done) {
    return (
      <p role="status" className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-success">
        <CircleCheck aria-hidden className="size-4" />
        {t.deliveredOk}
      </p>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" variant="outline" disabled={pending} onClick={mark}>
        {pending ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : <PackageCheck aria-hidden />}
        {pending ? t.delivering : t.markDelivered}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Only for the organizer: cancel while open; once drawn, pay each USDC prize (or paste the hash) and mark the rest delivered. */
export function HostPanel({
  lang,
  id,
  status,
  closesAt,
  hostAddress,
  prizes,
  t,
  errors,
  noCustody,
}: {
  lang: Lang;
  id: string;
  status: PublicGiveawayStatus;
  closesAt: string;
  hostAddress: string;
  prizes: readonly PublicPrize[];
  t: HostLabels;
  errors: Errors;
  noCustody: string;
}) {
  const past = usePastClose(closesAt);
  const canCancel = status === "open" && !past;
  const awarded = prizes.filter((p) => p.status === "awarded" && p.winnerAddress);
  if (!canCancel && awarded.length === 0) return null;

  return (
    <section aria-labelledby="host-title" className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 id="host-title" className="text-h2">
          {t.title}
        </h2>
        <p className="text-[13px] text-fg-muted">{t.intro}</p>
      </div>
      {canCancel ? <CancelGiveaway id={id} t={t} errors={errors} /> : null}
      {awarded.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border">
          {awarded.map((p) => (
            <li key={p.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0">
              <p className="text-sm break-words">
                {fill(t.prizeFor, { rank: p.rank, label: prizeTitle(p, lang), address: shortAddress(p.winnerAddress ?? "") })}
              </p>
              {p.kind === "crypto" && isChainId(p.chainId) && p.amount !== null ? (
                <div className="flex flex-col items-start gap-2">
                  <PayPrizeButton
                    prizeId={p.id}
                    chainId={p.chainId}
                    winnerAddress={p.winnerAddress ?? ""}
                    hostAddress={hostAddress}
                    amount={p.amount}
                    t={t}
                    errors={errors}
                  />
                  <PastePaymentForm prizeId={p.id} t={t} errors={errors} />
                </div>
              ) : p.kind === "custom" ? (
                <MarkDelivered prizeId={p.id} t={t} errors={errors} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {awarded.some((p) => p.kind === "crypto") ? (
        <p role="note" className="border-t border-border pt-3 text-[13px] text-fg-muted">
          {noCustody}
        </p>
      ) : null}
    </section>
  );
}
