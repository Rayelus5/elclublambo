"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Loader2, LogOut, Ticket } from "lucide-react";
import { usePastClose } from "@/components/giveaways/countdown";
import { PublicConnectLazy } from "@/components/public/public-connect-lazy";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { fill } from "@/lib/i18n/fill";
import { enterPublicGiveawayAction, leavePublicGiveawayAction } from "@/lib/public-giveaways/actions";

type JoinLabels = Dictionary["giveaways"]["detail"]["join"];
type Errors = Dictionary["giveaways"]["errors"];

/**
 * Entering an open giveaway (Review Focus 2). Without a session: the connect button, which comes back to `next`
 * (this page + `?join=1`); back with a session and `autoFocusJoin`, «Participar» has the focus, so one more click joins.
 */
export function JoinPanel({
  lang,
  id,
  closesAt,
  signedIn,
  entered,
  minTxCount,
  hasAllowlist,
  next,
  autoFocusJoin,
  t,
  errors,
}: {
  lang: Lang;
  id: string;
  closesAt: string;
  signedIn: boolean;
  entered: boolean;
  minTxCount: number;
  hasAllowlist: boolean;
  /** Public URL to come back to after signing in, ending in `?join=1`. */
  next: string;
  autoFocusJoin: boolean;
  t: JoinLabels;
  errors: Errors;
}) {
  const router = useRouter();
  const joinRef = useRef<HTMLButtonElement>(null);
  const [pending, start] = useTransition();
  const [action, setAction] = useState<"join" | "leave" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const past = usePastClose(closesAt);

  useEffect(() => {
    if (autoFocusJoin) joinRef.current?.focus();
  }, [autoFocusJoin]);

  function run(kind: "join" | "leave") {
    setError(null);
    setAction(kind);
    start(async () => {
      const r = kind === "join" ? await enterPublicGiveawayAction(id) : await leavePublicGiveawayAction(id);
      if (r.ok) router.refresh();
      else setError(errors[r.error] ?? errors.unknown);
    });
  }

  const requirements = [
    ...(minTxCount > 0 ? [fill(t.reqMinTx, { n: minTxCount })] : []),
    ...(hasAllowlist ? [t.reqAllowlist] : []),
  ];

  return (
    <section aria-labelledby="join-title" className="flex flex-col gap-4 rounded-panel border border-accent/60 bg-surface p-4 sm:p-6">
      <h2 id="join-title" className="text-h2">
        {t.title}
      </h2>
      <div className="flex flex-col gap-1">
        <h3 className="text-[13px] font-bold text-fg-muted">{t.requirements}</h3>
        {requirements.length === 0 ? (
          <p className="text-sm">{t.reqNone}</p>
        ) : (
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {requirements.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </div>

      {past ? (
        <p className="text-sm text-fg-muted">{t.closed}</p>
      ) : !signedIn ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-fg-muted">{t.connectHint}</p>
          <PublicConnectLazy lang={lang} next={next} />
        </div>
      ) : entered ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="inline-flex min-h-11 items-center gap-2 font-bold text-success">
            <CircleCheck aria-hidden className="size-5" />
            {t.entered}
          </p>
          <Button type="button" variant="outline" disabled={pending} onClick={() => run("leave")}>
            {pending && action === "leave" ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : <LogOut aria-hidden />}
            {pending && action === "leave" ? t.leaving : t.leave}
          </Button>
        </div>
      ) : (
        <Button ref={joinRef} type="button" size="lg" className="self-start" disabled={pending} onClick={() => run("join")}>
          {pending && action === "join" ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Ticket aria-hidden />}
          {pending && action === "join" ? t.joining : t.join}
        </Button>
      )}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <p className="text-[13px] text-fg-muted">{t.addressNotice}</p>
    </section>
  );
}
