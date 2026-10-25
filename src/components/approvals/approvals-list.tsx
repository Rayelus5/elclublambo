"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useAppKit } from "@reown/appkit/react";
import { CircleAlert, CircleHelp, ExternalLink, Info, Loader2, Plug, RefreshCw, ShieldCheck, ShieldOff, TriangleAlert } from "lucide-react";
import { formatUnits } from "viem";
import { ManualCheck } from "@/components/approvals/manual-check";
import { addRevokeNotice } from "@/components/approvals/revoke-notices";
import { Button } from "@/components/ui/button";
import { checkAllowanceAction } from "@/lib/approvals/actions";
import type { ApprovalRow, ApprovalScan } from "@/lib/approvals/types";
import { TX_REVERTED, useRevoke } from "@/lib/approvals/use-revoke";
import { shortAddress } from "@/lib/auth/wallet";
import { explorerAddress, NETWORKS, type ChainId } from "@/lib/economy/networks";
import { getDictionary, type Dictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { fill } from "@/lib/i18n/fill";
import { canSignFor } from "@/lib/web3/can-sign";
import {
  clearSent,
  isSentFresh,
  noStored,
  parseSent,
  readSentRaw,
  sentAtNow,
  subscribeStorage,
  writeErrorKind,
  writeSent,
  type Sent,
} from "@/lib/web3/signing";
import { useWalletMatch } from "@/lib/web3/use-wallet-match";

type Hash = `0x${string}`;
type Labels = Dictionary["approvals"]["list"];
type Phase = "signing" | "confirming";
/** How a re-check was reached: the receipt said success, the tx reverted, or the receipt never came (or a stored hash). */
type Sending = "confirmed" | "reverted" | "unconfirmed";

/** Wait before checking once more when a confirmed revoke still reads active (the server's node may be a block behind). */
const RECHECK_DELAY_MS = 3000;

const rowKey = (r: { token: string; spender: string }) => `${r.token}:${r.spender}`.toLowerCase();

/**
 * A revoke this browser signed whose re-check has not confirmed it yet, per (chain, owner, token, spender), so a reload
 * resumes on it («Comprobar de nuevo»). approve(spender, 0) is idempotent, so it never blocks signing again; it is
 * ignored after the give-up window (judged at mount and again when «Comprobar de nuevo» is pressed) and dropped once a
 * re-check gives a definitive answer.
 */
const storageKey = (chainId: ChainId, owner: string, r: { token: string; spender: string }) =>
  `elclub:revoke:${chainId}:${owner}:${r.token}:${r.spender}`.toLowerCase();

/** At most this many decimals are shown; a longer amount is cut and marked «aprox.». */
const SHOWN_DECIMALS = 6;

/** The allowance in token units (grouped, the language's separators), «Ilimitada», or base units without decimals. */
export function formatAllowance(row: ApprovalRow, lang: Lang, t: Labels): string {
  if (row.unlimited) return t.unlimited;
  const locale = lang === "es" ? "es-ES" : "en-GB";
  if (row.decimals === null) return fill(t.rawUnits, { amount: BigInt(row.allowance).toLocaleString(locale) });
  const [int = "0", frac = ""] = formatUnits(BigInt(row.allowance), row.decimals).split(".");
  const shown = frac.slice(0, SHOWN_DECIMALS).replace(/0+$/, "");
  const sep = lang === "es" ? "," : ".";
  const text = `${BigInt(int).toLocaleString(locale)}${shown ? `${sep}${shown}` : ""}`;
  return frac.length > SHOWN_DECIMALS && /[1-9]/.test(frac.slice(SHOWN_DECIMALS)) ? `${text} ${t.approx}` : text;
}

function Badge({ tone, children }: { tone: "warning" | "muted"; children: React.ReactNode }) {
  const Icon = tone === "warning" ? TriangleAlert : CircleHelp;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-control border px-2 py-0.5 text-[13px] font-bold ${tone === "warning" ? "border-warning/60 text-warning" : "border-border-strong text-fg-muted"}`}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}

function Item({
  lang,
  t,
  chainId,
  owner,
  row,
  phase,
  switching,
  error,
  disabled,
  reasonId,
  onRevoke,
  onCheck,
}: {
  lang: Lang;
  t: Labels;
  chainId: ChainId;
  owner: Hash;
  row: ApprovalRow;
  phase: Phase | null;
  switching: boolean;
  error: string | null;
  disabled: boolean;
  reasonId: string | undefined;
  onRevoke(): void;
  onCheck(sent: Sent): void;
}) {
  const stored = parseSent(useSyncExternalStore(subscribeStorage, () => readSentRaw(storageKey(chainId, owner, row)), noStored));
  const [now] = useState(sentAtNow);
  const pending = stored && isSentFresh(stored, now) ? stored : null;
  const tokenName = row.symbol ?? shortAddress(row.token);
  const spenderName = row.spenderLabel ?? shortAddress(row.spender);
  const busy = phase !== null;
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-panel border border-border p-4 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-start sm:gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[13px] text-fg-muted">{t.token}</span>
        <a
          href={explorerAddress(chainId, row.token)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={fill(t.tokenLink, { token: tokenName })}
          className="inline-flex min-h-11 items-center gap-1 self-start font-bold text-accent underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        >
          {tokenName}
          <ExternalLink aria-hidden className="size-3.5 shrink-0" />
        </a>
        <span className="font-mono text-[13px] break-all text-fg-muted">{row.token}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[13px] text-fg-muted">{t.spender}</span>
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-fg">{spenderName}</span>
          {row.spenderKind === "eoa" ? <Badge tone="warning">{t.eoa}</Badge> : row.spenderKind === "unknown_contract" ? <Badge tone="muted">{t.unknown}</Badge> : null}
        </span>
        <span className="font-mono text-[13px] break-all text-fg-muted">{row.spender}</span>
        {row.spenderKind === "eoa" ? <p className="text-sm text-fg">{t.eoaHint}</p> : null}
        <span className="mt-1 text-[13px] text-fg-muted">{t.amount}</span>
        <span className="flex flex-wrap items-center gap-2 font-bold text-fg tabular-nums">
          {row.unlimited ? <Badge tone="warning">{formatAllowance(row, lang, t)}</Badge> : formatAllowance(row, lang, t)}
        </span>
      </div>
      <div className="flex flex-col items-start gap-2 sm:items-end">
        <Button
          type="button"
          variant={busy ? "default" : "outline"}
          disabled={disabled || busy}
          aria-describedby={reasonId}
          onClick={onRevoke}
        >
          {busy ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : <ShieldOff aria-hidden />}
          {phase === "signing" ? (switching ? t.switching : t.signing) : phase === "confirming" ? t.confirming : t.revoke}
        </Button>
        {pending && !busy ? (
          <>
            {error ? null : <p className="text-[13px] text-fg-muted sm:text-right">{t.pending}</p>}
            <Button type="button" variant="outline" onClick={() => onCheck(pending)}>
              <RefreshCw aria-hidden />
              {t.checkAgain}
            </Button>
          </>
        ) : null}
        {error ? (
          <p role="alert" className="flex items-start gap-2 text-sm text-danger sm:text-right">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/**
 * The approvals of `owner` on `chainId` (P6-R2b/R2d), in the browser only (AppKit; see approvals-lazy.tsx). Anyone sees
 * the list; «Retirar» needs the owner's wallet connected and, with a SIWE session, the session on that wallet too
 * (Review Focus 2: the reason shows once, and nothing is ever signed otherwise). After the receipt the pair is checked
 * again on the server (once more after `recheckDelayMs` if it still reads active): at 0 the row goes and «Permiso
 * retirado» goes to <RevokeNotices> above the list, which outlives a refresh that drops the list. An unavailable or
 * partial scan never reads as «no approvals» (Review Focus 1): the manual check opens instead.
 */
export function ApprovalsList({
  lang,
  chainId,
  owner,
  scan,
  sessionWallet,
  recheckDelayMs = RECHECK_DELAY_MS,
}: {
  lang: Lang;
  chainId: ChainId;
  owner: Hash;
  scan: ApprovalScan;
  sessionWallet: Hash | null;
  recheckDelayMs?: number;
}) {
  const dict = getDictionary(lang).approvals;
  const t = dict.list;
  const router = useRouter();
  const { open: openWallet } = useAppKit();
  const { revoke, switching } = useRevoke();
  const wallet = useWalletMatch(owner);
  const network = NETWORKS[chainId];
  const [extra, setExtra] = useState<ApprovalRow[]>([]);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState<{ key: string; phase: Phase } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const scanned = scan.status === "ok" ? scan.rows : [];
  const seen = new Set<string>();
  const rows = [...scanned, ...extra].filter((r) => {
    const k = rowKey(r);
    if (seen.has(k) || removed.has(k)) return false;
    seen.add(k);
    return true;
  });

  const can = canSignFor(owner, wallet.address, sessionWallet);
  // While wagmi is still (re)connecting there is no reason to show yet; the buttons stay disabled meanwhile.
  const reason = can.ok ? null : can.reason === "session_mismatch" || wallet.mismatch ? can.reason : null;
  const reasonId = reason ? "approvals-sign-reason" : undefined;

  const setError = (key: string, text: string | null) =>
    setErrors((e) => {
      const next = { ...e };
      if (text) next[key] = text;
      else delete next[key];
      return next;
    });

  const read = async (row: ApprovalRow): Promise<Awaited<ReturnType<typeof checkAllowanceAction>>> => {
    try {
      return await checkAllowanceAction({ chain: network.key, owner, token: row.token, spender: row.spender });
    } catch {
      return { ok: false, error: "rpc_unavailable" };
    }
  };

  /**
   * Re-reads the pair after a revoke. A confirmed receipt that still reads active is read once more after
   * `recheckDelayMs`. At 0: the row goes, the confirmation is added and the stored hash dropped. Still active: a reverted
   * tx drops the stored hash (the user signs again); otherwise it is kept so «Comprobar de nuevo» stays.
   */
  async function recheck(row: ApprovalRow, hash: Hash, how: Sending) {
    const key = rowKey(row);
    const stored = storageKey(chainId, owner, row);
    setBusy({ key, phase: "confirming" });
    let res = await read(row);
    if (how === "confirmed" && res.ok && res.row !== null && alive.current) {
      await new Promise((r) => setTimeout(r, recheckDelayMs));
      if (alive.current) res = await read(row);
    }
    if (!alive.current) return;
    setBusy(null);
    if (res.ok && res.row === null) {
      clearSent(stored);
      setRemoved((s) => new Set(s).add(key));
      addRevokeNotice(chainId, owner, { key, hash, token: row.symbol ?? shortAddress(row.token) });
      setError(key, null);
      router.refresh();
      return;
    }
    if (how === "reverted") {
      clearSent(stored);
      setError(key, t.reverted);
      return;
    }
    setError(key, !res.ok ? t.checkFailed : how === "confirmed" ? t.stillActive : t.pending);
  }

  /** «Comprobar de nuevo»: the give-up window is judged now, not only when the row mounted. */
  function onCheck(row: ApprovalRow, sent: Sent) {
    if (busy) return;
    if (!isSentFresh(sent, sentAtNow())) {
      clearSent(storageKey(chainId, owner, row));
      setError(rowKey(row), null);
      return;
    }
    void recheck(row, sent.hash, "unconfirmed");
  }

  async function onRevoke(row: ApprovalRow) {
    if (busy || !can.ok || !wallet.address) return;
    const key = rowKey(row);
    setError(key, null);
    setBusy({ key, phase: "signing" });
    const sent: { hash: Hash | null } = { hash: null };
    try {
      const hash = await revoke({ chainId, token: row.token, spender: row.spender, account: wallet.address }, (h) => {
        sent.hash = h;
        writeSent(storageKey(chainId, owner, row), { hash: h, sentAt: sentAtNow() });
        setBusy({ key, phase: "confirming" });
      });
      if (!alive.current) return;
      await recheck(row, hash, "confirmed");
    } catch (err) {
      if (!alive.current) return;
      if (sent.hash) {
        // Sent, then the receipt failed or reverted: what the chain says now decides.
        await recheck(row, sent.hash, err instanceof Error && err.message === TX_REVERTED ? "reverted" : "unconfirmed");
        return;
      }
      setBusy(null);
      const kind = writeErrorKind(err);
      setError(key, kind === "switch" ? t.switchFailed : kind === "cancelled" ? t.cancelled : t.failed);
    }
  }

  // A partial list that shows nothing must not read as «no approvals»: the manual check opens instead.
  const manualOpen = scan.status === "unavailable" || (scan.partial && rows.length === 0);

  return (
    <section aria-labelledby="approvals-list" className="flex min-w-0 flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 id="approvals-list" className="font-display text-xl font-bold text-fg">
          {t.title}
        </h2>
        <p className="text-sm text-fg-muted">{fill(t.on, { network: network.name })}</p>
        <p className="font-mono text-sm break-all text-fg-muted">{owner}</p>
      </div>

      {reason ? (
        <div className="flex flex-col items-start gap-2">
          <p id={reasonId} className="flex items-start gap-2 text-sm text-warning">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
            {fill(t.reasons[reason], { address: shortAddress(owner) })}
          </p>
          {reason === "not_connected" ? (
            <Button type="button" variant="link" onClick={() => openWallet()}>
              <Plug aria-hidden />
              {t.connect}
            </Button>
          ) : null}
        </div>
      ) : null}

      {scan.status === "unavailable" ? (
        <p role="alert" className="flex items-start gap-2 rounded-control border border-warning/70 p-3 text-sm font-bold text-fg">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          {t.unavailable}
        </p>
      ) : scan.partial ? (
        <p className="flex items-start gap-2 rounded-control border border-warning/70 p-3 text-sm text-fg">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          {t.partial}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => {
            const key = rowKey(r);
            return (
              <Item
                key={key}
                lang={lang}
                t={t}
                chainId={chainId}
                owner={owner}
                row={r}
                phase={busy?.key === key ? busy.phase : null}
                switching={switching}
                error={errors[key] ?? null}
                disabled={!can.ok || (busy !== null && busy.key !== key)}
                reasonId={reasonId}
                onRevoke={() => onRevoke(r)}
                onCheck={(s) => onCheck(r, s)}
              />
            );
          })}
        </ul>
      ) : scan.status === "ok" && !scan.partial ? (
        <p className="flex items-start gap-2 text-base text-fg">
          <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
          {fill(t.empty, { network: network.name })}
        </p>
      ) : null}

      <ManualCheck
        t={dict.manual}
        network={network.key}
        owner={owner}
        open={manualOpen}
        onFound={(row) => {
          const key = rowKey(row);
          setRemoved((s) => {
            const next = new Set(s);
            next.delete(key);
            return next;
          });
          setExtra((x) => [...x.filter((r) => rowKey(r) !== key), row]);
        }}
      />
    </section>
  );
}
