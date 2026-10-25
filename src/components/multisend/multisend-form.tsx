"use client";

import { useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import { useAppKit } from "@reown/appkit/react";
import { CircleAlert, CircleCheck, Info, Layers, Loader2, Plug, RefreshCw, RotateCcw, Send, TriangleAlert } from "lucide-react";
import { NetworkPicker } from "@/components/economy/network-picker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { shortAddress } from "@/lib/auth/wallet";
import { assetId, assetsFor } from "@/lib/economy/assets";
import { NETWORKS, type ChainId } from "@/lib/economy/networks";
import { getDictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { fill } from "@/lib/i18n/fill";
import { decodeLines } from "@/lib/multisend/fragment";
import { listKey, parseRecipients } from "@/lib/multisend/parse";
import {
  alignProgress,
  clearProgress,
  parseProgress,
  parseRecent,
  progressKey,
  readProgressRaw,
  readRecentRaw,
  storageAvailable,
  type RowState,
} from "@/lib/multisend/progress";
import { lockedByOther, readLockRaw, TAB_ID } from "@/lib/multisend/run-lock";
import { useMultisend } from "@/lib/multisend/use-multisend";
import { useWalletIdle } from "@/lib/multisend/wallet-idle";
import { formatAmount } from "@/lib/payments/amounts";
import { useAssetBalances } from "@/lib/payments/balances";
import { canSignFor } from "@/lib/web3/can-sign";
import { noStored, sentAtNow, subscribeStorage } from "@/lib/web3/signing";
import { useWalletMatch } from "@/lib/web3/use-wallet-match";
import { ConfirmDialog } from "./confirm-dialog";
import { ProgressList } from "./progress-list";

type Address = `0x${string}`;

/** USDC base units in the language's decimal separator, without trailing zeros. */
export function formatUsdc(units: bigint, lang: Lang): string {
  const text = formatAmount(units, "USDC");
  return lang === "es" ? text : text.replace(",", ".");
}

const readHashList = () => decodeLines(window.location.hash) ?? "";

/**
 * The multisend tool (P6-R3), in the browser only (AppKit; see multisend-lazy.tsx): the network, the pasted list with a
 * per-line preview, the summary against the wallet's balance, and «Enviar» (the screen's one fill), enabled only with
 * 1–20 valid lines, no errors, the owner's wallet (the session's, when there is one; Review Focus 2) and enough USDC
 * and gas. «Enviar» opens the confirmation (P6-R8) and only «Confirmar y firmar» signs. Progress saved for the same list
 * and wallet shows up with its hashes, and «Continuar» confirms and sends only what is left (Review Focus 4).
 */
export function MultisendForm({ lang, chains, sessionWallet }: { lang: Lang; chains: readonly ChainId[]; sessionWallet: Address | null }) {
  const dict = getDictionary(lang);
  const t = dict.multisend;
  const id = useId();
  const { open: openWallet } = useAppKit();
  const wallet = useWalletMatch(sessionWallet);
  const [chain, setChain] = useState<ChainId>(() => chains.find((c) => NETWORKS[c].key === "base") ?? chains[0]!);
  const [text, setText] = useState(readHashList);
  const [confirming, setConfirming] = useState(false);
  const [ignoredRun, setIgnoredRun] = useState<readonly RowState[] | null>(null);
  // Ticks, per line id, each tied to the state it was given in (tickStamp): `not_found` lines the user checked were
  // not sent (C1), and repeats of the last 24 h the user accepts (C3). A tick counts only while its stamp still
  // matches, so it is void once the line changes state or a run ends (finding 6).
  const [released, setReleased] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [repeatOk, setRepeatOk] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [now, setNow] = useState(sentAtNow);
  const [storageProbe] = useState(storageAvailable);
  const ms = useMultisend(chain);
  const network = NETWORKS[chain];
  const fmt = (units: bigint) => formatUsdc(units, lang);

  // A clock for what goes stale on its own: another tab's lock (R5) and the 24 h record.
  useEffect(() => {
    const timer = setInterval(() => setNow(sentAtNow()), 10_000);
    return () => clearInterval(timer);
  }, []);

  // «Repartir gastos» on this same page links to #envio=…: a new list in the fragment replaces the text.
  useEffect(() => {
    const onHash = () => {
      const next = decodeLines(window.location.hash);
      if (next !== null) setText(next);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const parsed = useMemo(() => parseRecipients(text, chain), [text, chain]);
  const { recipients, errors, merged, total } = parsed;
  const key = useMemo(() => listKey(chain, recipients), [chain, recipients]);

  const owner: Address | undefined = sessionWallet ?? wallet.address;
  const can = owner ? canSignFor(owner, wallet.address, sessionWallet) : ({ ok: false, reason: "not_connected" } as const);
  // While wagmi is still (re)connecting there is no reason to show yet; «Enviar» stays disabled meanwhile.
  const reason = can.ok ? null : can.reason === "session_mismatch" || wallet.mismatch ? can.reason : null;

  const assets = useMemo(() => assetsFor([chain]).filter((a) => a.token === "USDC"), [chain]);
  const balances = useAssetBalances(assets, wallet.address);
  const usdcBalance = balances[assetId("USDC", chain)] ?? null;
  const ethBalance = balances[assetId("ETH", chain)] ?? null;

  const storedRaw = useSyncExternalStore(subscribeStorage, () => (owner && recipients.length > 0 ? readProgressRaw(owner, chain, key) : null), noStored);
  const stored = useMemo(() => alignProgress(parseProgress(storedRaw), recipients), [storedRaw, recipients]);
  const live =
    owner && ms.runKey === progressKey(owner, chain, key) && ms.rows !== ignoredRun ? alignProgress(ms.rows, recipients) : null;
  const progress = live ?? stored;
  const started = progress !== null && progress.some((r) => r.status !== "todo");
  const done = progress !== null && progress.every((r) => r.status === "confirmed");

  const rowOf = (lineId: string) => progress?.find((r) => r.id === lineId);
  const tickStamp = (lineId: string) => {
    const r = rowOf(lineId);
    return `${ms.runs}|${r?.status ?? "todo"}|${r?.hash ?? ""}|${r?.attempt?.at ?? ""}`;
  };
  const ticked = (ticks: ReadonlyMap<string, string>, lineId: string) => ticks.get(lineId) === tickStamp(lineId);

  // C2 and the state model: only `todo` lines and ticked `not_found` lines are signed; the other unconfirmed lines are
  // only re-checked on chain (never signed in that run).
  const statusAt = (i: number) => progress?.[i]?.status ?? "todo";
  // R1: a not_found line may be ticked (and a tick counts) only while the wallet has no pending tx, read successfully.
  const idle = useWalletIdle(chain, owner, !!progress?.some((r) => r.status === "not_found"));
  const canRelease = idle === "idle";
  const releasedIds = new Set(recipients.filter((r, i) => canRelease && statusAt(i) === "not_found" && ticked(released, r.id)).map((r) => r.id));
  const approved = new Set(recipients.filter((_, i) => statusAt(i) === "todo").map((r) => r.id));
  const toSign = recipients.filter((r) => approved.has(r.id) || releasedIds.has(r.id));
  const toCheck = progress ? progress.filter((r) => r.status !== "confirmed" && r.status !== "todo" && !releasedIds.has(r.id)) : [];
  const signTotal = toSign.reduce((sum, r) => sum + r.amount, 0n);

  // C3: a line still to sign that matches a confirmed send of the last 24 h (not one of this list's own) needs a tick.
  const recentRaw = useSyncExternalStore(subscribeStorage, readRecentRaw, noStored);
  const ownHashes = new Set((progress ?? []).map((r) => r.hash).filter(Boolean));
  const recent = parseRecent(recentRaw, chain, now).filter((e) => !e.hash || !ownHashes.has(e.hash));
  const repeats = new Set(
    toSign.filter((r) => recent.some((e) => e.to.toLowerCase() === r.to.toLowerCase() && e.amount === r.amount.toString())).map((r) => r.id),
  );
  const repeatBlocked = [...repeats].some((r) => !ticked(repeatOk, r));
  const storageOff = !storageProbe || !ms.storageOk;
  // R5: another tab running this list.
  const lockRaw = useSyncExternalStore(subscribeStorage, () => (owner && recipients.length > 0 ? readLockRaw(progressKey(owner, chain, key)) : null), noStored);
  const lockedElsewhere = lockedByOther(lockRaw, TAB_ID, now);

  const valid = recipients.length > 0 && errors.length === 0;
  const insufficient = valid && usdcBalance !== null && signTotal > usdcBalance;
  const noGas = valid && toSign.length > 0 && !insufficient && ethBalance !== null && ethBalance <= 0n;
  const ready = valid && can.ok && !done && ms.mode !== "checking" && !ms.running && !lockedElsewhere;
  const canSend = ready && toSign.length > 0 && !insufficient && !noGas && !repeatBlocked;
  const onlyCheck = ready && toSign.length === 0 && toCheck.length > 0;

  const reasonId = `${id}-reason`;
  const fixId = `${id}-fix`;
  const balanceId = `${id}-balance`;
  const repeatId = `${id}-repeat`;
  const lockId = `${id}-lock`;
  const describedBy =
    [reason ? reasonId : null, lockedElsewhere ? lockId : null, errors.length > 0 ? fixId : null, insufficient || noGas ? balanceId : null, repeatBlocked ? repeatId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  const preview = useMemo(
    () =>
      [
        ...errors.map((e) => ({ line: e.line, issue: e.code, to: null, amount: null, id: null })),
        ...recipients.map((r) => ({ line: r.line, issue: null, to: r.to, amount: r.amount, id: r.id })),
      ].sort((a, b) => a.line - b.line),
    [errors, recipients],
  );

  function onConfirm() {
    setConfirming(false);
    if (!canSend || !owner) return;
    setIgnoredRun(null);
    void ms.send(recipients, owner, key, approved, releasedIds);
  }

  /** Re-check only: nothing can be signed (empty sets). Also «Reintentar comprobación» on a scan_failed line. */
  function onCheck() {
    if (!(onlyCheck || (ready && toCheck.length > 0)) || !owner) return;
    setIgnoredRun(null);
    void ms.send(recipients, owner, key, new Set(), new Set());
  }

  const toggle = (set: (f: (s: ReadonlyMap<string, string>) => ReadonlyMap<string, string>) => void, lineId: string, on: boolean) => {
    const stamp = tickStamp(lineId);
    set((s) => {
      const next = new Map(s);
      if (on) next.set(lineId, stamp);
      else next.delete(lineId);
      return next;
    });
  };

  function onRestart() {
    if (!owner || !done) return;
    clearProgress(owner, chain, key);
    ms.forget(owner, key);
    setIgnoredRun(ms.rows);
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <p className="flex items-start gap-2 rounded-control border border-border p-3 text-sm text-fg-muted">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        {dict.common.noCustody}
      </p>
      {lockedElsewhere ? (
        <p role="status" className="flex items-start gap-2 rounded-control border border-warning/70 p-3 text-sm font-bold text-fg">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          <span id={lockId}>{t.form.locked}</span>
        </p>
      ) : null}
      {storageOff ? (
        <p role="status" className="flex items-start gap-2 rounded-control border border-warning/70 p-3 text-sm font-bold text-fg">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          {t.form.storageOff}
        </p>
      ) : null}

      <section aria-labelledby={`${id}-list`} className="flex min-w-0 flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6">
        <NetworkPicker value={chain} onChange={setChain} chains={chains} label={t.form.network} />
        <div className="flex flex-col gap-2">
          <label id={`${id}-list`} htmlFor={`${id}-text`} className="text-sm font-bold text-fg">
            {t.form.label}
          </label>
          <textarea
            id={`${id}-text`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder={"0x…, 12,5"}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={errors.length > 0 ? true : undefined}
            aria-describedby={`${id}-hint${errors.length > 0 ? ` ${fixId}` : ""}`}
            className="min-h-36 w-full min-w-0 rounded-control border border-input bg-transparent px-3 py-2 font-mono text-base break-all text-fg outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg aria-invalid:border-destructive md:text-sm"
          />
          <p id={`${id}-hint`} className="text-sm text-fg-muted">
            {t.form.hint}
          </p>
        </div>

        {preview.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h2 id={`${id}-preview`} className="text-sm font-bold text-fg">
              {t.form.preview}
            </h2>
            <ul aria-labelledby={`${id}-preview`} className="flex flex-col divide-y divide-border rounded-control border border-border">
              {preview.map((p) => (
                <li key={p.line} className="flex min-w-0 flex-col gap-0.5 px-3 py-2 sm:flex-row sm:items-baseline sm:gap-3">
                  <span className="shrink-0 text-[13px] text-fg-muted">{fill(t.form.line, { n: p.line })}</span>
                  {p.issue ? (
                    <span className="flex items-start gap-2 text-sm text-danger">
                      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                      {t.form.issues[p.issue]}
                    </span>
                  ) : (
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                        <span className="font-mono text-[13px] break-all text-fg">{p.to}</span>
                        <span className="shrink-0 text-sm font-bold text-fg tabular-nums">{fmt(p.amount!)} USDC</span>
                      </span>
                      {p.id && repeats.has(p.id) ? (
                        <span className="flex flex-col items-start gap-1">
                          <span className="flex items-start gap-2 text-sm text-fg">
                            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                            {fill(t.form.repeat, { amount: fmt(p.amount!) })}
                          </span>
                          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-fg">
                            <Checkbox checked={ticked(repeatOk, p.id)} onCheckedChange={(v) => toggle(setRepeatOk, p.id!, v === true)} />
                            {t.form.repeatAccept}
                          </label>
                        </span>
                      ) : null}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {merged.map((m) => (
              <p key={m.to} className="flex items-start gap-2 text-sm text-fg">
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                {fill(t.form.merged, { lines: m.lines.join(", ") })}
              </p>
            ))}
            {repeatBlocked ? (
              <p id={repeatId} className="flex items-start gap-2 text-sm font-bold text-fg">
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                {t.form.repeatBlock}
              </p>
            ) : null}
            {errors.length > 0 ? (
              <p id={fixId} className="flex items-start gap-2 text-sm font-bold text-danger">
                <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                {t.form.fixErrors}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section aria-labelledby={`${id}-summary`} className="flex min-w-0 flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6">
        <h2 id={`${id}-summary`} className="font-display text-xl font-bold text-fg">
          {t.form.summary}
        </h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-0.5">
            <dt className="text-[13px] text-fg-muted">{t.form.total}</dt>
            <dd className="text-lg font-bold text-fg tabular-nums">{fmt(total)} USDC</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-[13px] text-fg-muted">{t.form.recipients}</dt>
            <dd className="text-lg font-bold text-fg tabular-nums">{recipients.length}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-[13px] text-fg-muted">{t.form.balance}</dt>
            <dd className="text-lg font-bold text-fg tabular-nums">{usdcBalance === null ? t.form.unknown : `${fmt(usdcBalance)} USDC`}</dd>
          </div>
        </dl>

        {insufficient || noGas ? (
          <p id={balanceId} role="alert" className="flex items-start gap-2 text-sm font-bold text-danger">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {insufficient ? fill(t.form.insufficient, { balance: fmt(usdcBalance!) }) : fill(t.form.noGas, { network: network.name })}
          </p>
        ) : null}

        {valid && can.ok ? (
          <p className="flex items-start gap-2 text-sm text-fg-muted">
            <Layers aria-hidden className="mt-0.5 size-4 shrink-0" />
            {ms.mode === "atomic" ? t.form.atomic : ms.mode === "checking" ? t.form.checking : t.form.sequential}
          </p>
        ) : null}

        {reason ? (
          <div className="flex flex-col items-start gap-2">
            <p id={reasonId} className="flex items-start gap-2 text-sm text-warning">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
              {fill(t.form.reasons[reason], { address: owner ? shortAddress(owner) : "" })}
            </p>
            {reason === "not_connected" ? (
              <Button type="button" variant="link" onClick={() => openWallet()}>
                <Plug aria-hidden />
                {t.form.connect}
              </Button>
            ) : null}
          </div>
        ) : null}

        {progress && started ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-bold text-fg">{t.progress.title}</h3>
            <ProgressList
              t={t.progress}
              chainId={chain}
              rows={progress}
              lines={recipients.map((r) => r.line)}
              formatUsdc={fmt}
              released={releasedIds}
              onRelease={(lineId, on) => toggle(setReleased, lineId, on)}
              onRetry={onCheck}
              retryDisabled={!ready}
              releaseDisabled={!canRelease}
              releaseBlocked={idle === "pending" ? t.progress.walletPending : idle === "unknown" ? t.progress.walletUnknown : null}
            />
            <p className="text-[13px] text-fg-muted">{t.progress.scanNote}</p>
          </div>
        ) : null}

        {ms.error ? (
          <div className="flex flex-col items-start gap-2">
            <p role="alert" className="flex items-start gap-2 text-sm font-bold text-danger">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {fill(t.progress.errors[ms.error], { network: network.name })}
            </p>
            {ms.error === "atomic_failed" && ms.mode === "atomic" ? (
              <Button type="button" variant="outline" onClick={ms.sendOneByOne}>
                <Send aria-hidden />
                {t.progress.oneByOne}
              </Button>
            ) : null}
          </div>
        ) : null}

        {done ? (
          <div className="flex flex-col items-start gap-3">
            <p role="status" className="flex items-start gap-2 text-base font-bold text-fg">
              <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
              {t.progress.done}
            </p>
            <Button type="button" variant="outline" onClick={onRestart}>
              <RotateCcw aria-hidden />
              {t.form.restart}
            </Button>
          </div>
        ) : onlyCheck ? (
          <Button type="button" className="self-start" onClick={onCheck}>
            <RefreshCw aria-hidden />
            {t.form.check}
          </Button>
        ) : (
          <Button
            type="button"
            className="self-start"
            disabled={!canSend}
            aria-describedby={describedBy}
            onClick={() => canSend && setConfirming(true)}
          >
            {ms.running ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Send aria-hidden />}
            {ms.running ? (ms.switching ? t.form.switching : t.form.sending) : started ? t.form.continue : t.form.send}
          </Button>
        )}
      </section>

      <ConfirmDialog
        t={t.confirm}
        open={confirming}
        onOpenChange={setConfirming}
        total={fmt(signTotal)}
        count={toSign.length}
        checks={toCheck.length}
        balanceUnknown={usdcBalance === null || ethBalance === null}
        network={network.name}
        onConfirm={onConfirm}
      />
    </div>
  );
}
