"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Loader2, Vote } from "lucide-react";
import { HowItWorksLink } from "@/components/guide/how-it-works-link";
import { Button } from "@/components/ui/button";
import { rpcErrorMessage } from "@/lib/errors";
import { votePollAction } from "@/lib/polls/actions";
import { formatTenths, pollTimeLeft, voterCountLabel, type PollDetail } from "@/lib/polls/polls";
import { formatWhen } from "@/lib/treasury/panel";
import { cn } from "@/lib/utils";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** Re-read delays after the close while the server still says open: 2 s, 5 s, 15 s, then every 30 s. */
const CLOSE_RETRY_MS = [2_000, 5_000, 15_000, 30_000] as const;

const noSubscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/**
 * The card of a poll message, under its question. It renders only what poll_details returned for the caller: the own
 * option while the poll is open, never anyone else's. After the close it says "Votaste" without the option, and shows
 * bars only when the server published them (each one a percentage of the votes, rounded, so they may not add up to exactly
 * 100 %). `readOnly` (pinned list) renders no vote controls.
 */
export function PollCard({
  poll,
  onChanged,
  readOnly = false,
  now = Date.now,
}: {
  poll: PollDetail;
  /** The poll must be re-read: after voting, and when the close time passes (repeated until a re-read says closed). */
  onChanged: () => void;
  readOnly?: boolean;
  /** Injected by tests; defaults to the wall clock. */
  now?: () => number;
}) {
  const [nowMs, setNowMs] = useState(() => now());
  // False on the server and during hydration, true after mount: the first pass renders from poll.closed alone, so the
  // server HTML and the hydrating client always pick the same branch at the close; the local clock is adopted after.
  const mounted = useSyncExternalStore(noSubscribe, clientSnapshot, serverSnapshot);
  const [picked, setPicked] = useState<string | null>(null);
  // After a successful vote, the server's vote as it now stands, until the next prop arrives: the card stays
  // consistent ("Tu voto", "Cambiar voto" disabled) even if the re-read fails.
  const [optimistic, setOptimistic] = useState<string | null>(null);
  // Once the server's vote changes (the re-read after a successful vote, or a vote from another tab) the local pick is
  // spent and the card follows the server again; any new prop ends the optimistic vote (React's "adjust state when a
  // prop changes" pattern, during render).
  const [seenMine, setSeenMine] = useState(poll.myOptionId);
  if (seenMine !== poll.myOptionId) {
    setSeenMine(poll.myOptionId);
    setPicked(null);
  }
  const [seenPoll, setSeenPoll] = useState(poll);
  if (seenPoll !== poll) {
    setSeenPoll(poll);
    setOptimistic(null);
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const firedFor = useRef<string | null>(null);
  // Re-reads made since the close timer fired while the server still said open; `retryTick` re-runs the effect.
  const closeRetries = useRef(0);
  const [retryTick, setRetryTick] = useState(0);
  const radios = useRef<Array<HTMLButtonElement | null>>([]);

  // Keep the latest callbacks without re-arming timers on every render.
  const onChangedRef = useRef(onChanged);
  const nowRef = useRef(now);
  useEffect(() => {
    onChangedRef.current = onChanged;
    nowRef.current = now;
  });

  const closesMs = Date.parse(poll.closesAt);
  const closed = poll.closed || (mounted && nowMs >= closesMs);

  // Minute ticker: keeps "Cierra en ..." fresh and re-evaluates whether the close timer can be armed.
  useEffect(() => {
    if (closed) return;
    const id = setInterval(() => setNowMs(nowRef.current()), MINUTE_MS);
    return () => clearInterval(id);
  }, [closed]);

  // Close timer: only armed when < 24 h remain (a longer setTimeout would overflow); the ticker re-arms it. The close
  // counts as handled only once a re-read says closed: while the server still says open (its clock may lag ours), keep
  // re-reading with a capped backoff. Stops when a closed prop arrives or on unmount (the cleanup clears the timer).
  useEffect(() => {
    if (poll.closed || !Number.isFinite(closesMs)) return;
    if (firedFor.current === poll.closesAt) {
      const delay = CLOSE_RETRY_MS[Math.min(closeRetries.current, CLOSE_RETRY_MS.length - 1)]!;
      const id = setTimeout(() => {
        closeRetries.current += 1;
        setRetryTick((t) => t + 1);
        onChangedRef.current();
      }, delay);
      return () => clearTimeout(id);
    }
    const remaining = closesMs - nowRef.current();
    if (remaining >= DAY_MS) return;
    const id = setTimeout(
      () => {
        firedFor.current = poll.closesAt;
        closeRetries.current = 0;
        setNowMs(nowRef.current());
        setRetryTick((t) => t + 1);
        onChangedRef.current();
      },
      Math.max(remaining, 0),
    );
    return () => clearTimeout(id);
  }, [poll.closed, poll.closesAt, closesMs, nowMs, retryTick]);

  const mine = optimistic ?? poll.myOptionId;
  const effective = picked ?? mine;
  const hasVote = mine !== null;
  const myLabel = poll.options.find((o) => o.id === mine)?.label ?? null;
  const canSubmit = effective !== null && effective !== mine && !busy;

  const submit = async () => {
    if (!effective || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    const res = await votePollAction(poll.messageId, effective).catch(() => ({ ok: false as const, code: "unknown", error: rpcErrorMessage("unknown") }));
    sending.current = false;
    setBusy(false);
    if (res.ok) {
      setOptimistic(effective);
      setPicked(null);
      onChanged();
      return;
    }
    setError(res.error);
    // Nothing changed on the server: the highlight goes back to the vote that stands.
    setPicked(null);
    // The poll may have closed or changed meanwhile: re-read it either way.
    if (res.code === "poll_closed") onChanged();
  };

  const move = (from: number, step: number) => {
    const n = poll.options.length;
    const to = (from + step + n) % n;
    const next = poll.options[to];
    if (next) setPicked(next.id);
    radios.current[to]?.focus();
  };

  const results = poll.results;

  return (
    <div className="flex w-full max-w-2xl flex-col gap-3 rounded-panel border border-border-strong bg-surface p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="inline-flex min-h-7 items-center gap-1.5 rounded-control border border-accent px-2 text-[13px] font-bold text-accent">
          <Vote aria-hidden className="size-3.5" />
          Encuesta
        </span>
        <span className="text-sm text-fg-muted">1 persona, 1 voto</span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {/* Keyed on `mounted`: the server's text (its clock) is kept by suppressHydrationWarning, so the span is
            re-created once the local clock is adopted. */}
        <span key={mounted ? "local" : "first"} suppressHydrationWarning title={`Cierra el ${formatWhen(poll.closesAt)}`} className={cn("font-bold", closed ? "text-fg-muted" : "text-fg")}>
          {closed ? "Cerrada" : pollTimeLeft(poll.closesAt, nowMs)}
        </span>
        <span aria-live="polite" className="text-fg-muted">
          {voterCountLabel(poll.voterCount)}
        </span>
      </div>

      <p className="text-sm text-fg-muted">Voto secreto · resultados al cerrar</p>
      <p className="text-sm text-fg-muted">Consultiva: el resultado no se aplica solo.</p>

      {!closed && !readOnly ? (
        <>
          <div role="radiogroup" aria-label="Opciones" className="flex flex-col gap-2">
            {poll.options.map((o, i) => {
              const checked = effective === o.id;
              const tabbable = effective === null ? i === 0 : checked;
              return (
                <button
                  key={o.id}
                  ref={(el) => {
                    radios.current[i] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  tabIndex={tabbable ? 0 : -1}
                  disabled={busy}
                  onClick={() => setPicked(o.id)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
                      e.preventDefault();
                      move(i, 1);
                    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
                      e.preventDefault();
                      move(i, -1);
                    }
                  }}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-3 rounded-control border px-3 py-2 text-left text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60",
                    checked ? "border-accent bg-surface-2" : "border-border hover:bg-surface-2",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn("grid size-5 shrink-0 place-items-center rounded-full border-2", checked ? "border-accent" : "border-border-strong")}
                  >
                    {checked ? <span className="size-2.5 rounded-full bg-accent" /> : null}
                  </span>
                  <span className="min-w-0 break-words">{o.label}</span>
                </button>
              );
            })}
          </div>

          <p className="text-sm text-fg">{hasVote ? `Tu voto: ${myLabel ?? ""}` : "Aún no has votado."}</p>
          {hasVote ? <p className="text-sm text-fg-muted">Puedes cambiarlo hasta el cierre.</p> : null}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" disabled={!canSubmit} onClick={() => void submit()}>
              {busy ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
              {hasVote ? "Cambiar voto" : "Votar"}
            </Button>
            <HowItWorksLink section="encuestas" />
          </div>
        </>
      ) : (
        <>
          {closed && poll.iVoted ? <p className="text-sm font-bold text-fg">Votaste</p> : null}
          {closed && results.status === "pending" ? <p className="text-sm text-fg-muted">Calculando los resultados…</p> : null}
          {results.status === "insufficient" ? (
            <div className="flex flex-col gap-1">
              <p className="text-sm text-fg">Muy pocos votos para mostrar los resultados sin revelar quién votó qué.</p>
            </div>
          ) : null}
          {results.status === "published" ? (
            <>
              <ul aria-label="Resultados" className="flex flex-col gap-3">
                {poll.options.map((o) => {
                  const t = results.tenths[o.id] ?? 0;
                  return (
                    <li key={o.id} className="flex flex-col gap-1">
                      <div className="flex items-start justify-between gap-3 text-sm">
                        <span className="min-w-0 break-words text-fg">{o.label}</span>
                        <span className="shrink-0 font-mono font-bold text-fg">{formatTenths(t)}</span>
                      </div>
                      <div aria-hidden className="h-2 w-full overflow-hidden rounded-control bg-surface-2">
                        <div data-testid="poll-bar" aria-hidden="true" className="h-full bg-accent" style={{ width: `${t / 10}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="text-sm text-fg-muted">{`${voterCountLabel(poll.voterCount)} · % de los votos`}</p>
            </>
          ) : null}
          <HowItWorksLink section="encuestas" className="self-start" />
        </>
      )}
    </div>
  );
}
