"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAppKit } from "@reown/appkit/react";
import { CircleAlert, CircleCheck, Clock, HeartHandshake, Info, Loader2, Plug, RefreshCw, ShieldCheck } from "lucide-react";
import { useAccount } from "wagmi";
import { AssetLogo } from "@/components/economy/asset-logo";
import { AssetPicker } from "@/components/payments/asset-picker";
import { PublicConnectLazy } from "@/components/public/public-connect-lazy";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { shortAddress } from "@/lib/auth/wallet";
import { attachPublicDonationTxAction, createPublicDonationIntentAction, verifyPublicDonationAction, type PublicVerifyResult } from "@/lib/donations/public-actions";
import { assetsFor, rankAssets, type AssetId } from "@/lib/economy/assets";
import { explorerTx, isChainId, NETWORKS, type ChainId } from "@/lib/economy/networks";
import type { Dictionary, Lang } from "@/lib/i18n";
import { fill } from "@/lib/i18n/fill";
import { formatAmount, parseAmount, TIP_LIMITS, TOKEN_DECIMALS, type Token } from "@/lib/payments/amounts";
import { useAssetBalances, useInvalidateAssetBalances } from "@/lib/payments/balances";
import { isDefinitiveFailure } from "@/lib/payments/outcomes";
import { PERMANENT_ATTACH_CODES } from "@/lib/payments/pending-sends";
import { useBalancePreflight } from "@/lib/payments/preflight";
import type { TipIntent } from "@/lib/payments/tip-actions";
import { useEnsureChain } from "@/lib/payments/use-ensure-chain";
import { useSendTransfer } from "@/lib/payments/use-send-transfer";
import { formatUsdIn } from "@/lib/treasury/format";

// Same state machine as the club's donate dialog (src/components/donations/donate-dialog.tsx), without its
// EconomyProvider: the session comes from the page (getPublicSession) and the recipient is always the intent's
// recipientAddress (the club Safe of that network, decided by the server), never a client constant.

type T = Dictionary["donate"];
type Hash = `0x${string}`;

const POLL_MS = 3000;
const POLL_WINDOW_MS = 120_000;
const RETRY_DELAYS_MS = [1000, 2000, 4000];
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * A lost or invalid session on attach/verify. Never permanent here: the donation may already be on-chain, so the stored
 * hash is kept and the panel asks to sign in again (the page then resumes it, and the server re-verifies it on a visit).
 */
const SESSION_CODES: ReadonlySet<string> = new Set(["forbidden", "not_authenticated"]);

/** A sent donation waiting to be recorded: kept per wallet and intent so a reload resumes it instead of sending again. */
type Stored = { intentId: string; chainId: ChainId; hash: Hash; attached: boolean };

const PREFIX = "elclub:pub-donate:";
export const storageKey = (wallet: string, intentId: string) => `${PREFIX}${wallet.toLowerCase()}:${intentId}`;

function parseStored(raw: string | null): Stored | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Stored>;
    if (typeof v.intentId === "string" && UUID_RE.test(v.intentId) && typeof v.hash === "string" && HASH_RE.test(v.hash) && isChainId(v.chainId)) {
      return { intentId: v.intentId, chainId: v.chainId, hash: v.hash as Hash, attached: v.attached === true };
    }
  } catch {
    // Not ours.
  }
  return null;
}

/** Storage may be missing or throw (private mode, blocked site data): then the guard only lasts while the page is open. */
function findStored(wallet: string): Stored | null {
  try {
    const ls = window.localStorage;
    const prefix = `${PREFIX}${wallet.toLowerCase()}:`;
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (!k?.startsWith(prefix)) continue;
      const s = parseStored(ls.getItem(k));
      if (s) return s;
      ls.removeItem(k);
    }
  } catch {
    // No storage.
  }
  return null;
}

function writeStored(wallet: string, s: Stored): void {
  try {
    window.localStorage.setItem(storageKey(wallet, s.intentId), JSON.stringify(s));
  } catch {
    // No storage.
  }
}

function clearStored(wallet: string, intentId: string): void {
  try {
    window.localStorage.removeItem(storageKey(wallet, intentId));
  } catch {
    // No storage.
  }
}

function isRejection(err: unknown): boolean {
  for (let cur: unknown = err, i = 0; cur && typeof cur === "object" && i < 4; i++) {
    const o = cur as { name?: unknown; code?: unknown; cause?: unknown };
    if (o.name === "UserRejectedRequestError" || o.code === 4001) return true;
    cur = o.cause;
  }
  return false;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Props = {
  lang: Lang;
  t: T;
  session: { wallet: Hash; isMember: boolean } | null;
  /** Networks whose club Safe is deployed (donationChains()). Empty: donations are not open yet. */
  chains: readonly ChainId[];
  /** The Safe check failed (RPC or database): «could not load», distinct from «no Safe deployed». */
  chainsFailed?: boolean;
  /** The signed-in non-member's confirmed public donations, USD6 as text (null when the read failed). */
  myTotalUsd6: string | null;
  /** Where the public sign-in returns to. */
  next: string;
};

const NOTE = "flex items-start gap-2 text-[13px] text-fg-muted";

/** Custody and economic-rights notices: on every state of the panel (money screen). */
function Notices({ t }: { t: T }) {
  return (
    <div className="flex flex-col gap-1 border-t border-border pt-4">
      <p className={NOTE}>
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
        {t.noCustody}
      </p>
      <p className={NOTE}>
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        {t.noRights}
      </p>
    </div>
  );
}

/** The donate panel of the public page: sign-in, member redirect, «not available yet», or the donation flow. */
export function PublicDonatePanel(props: Props) {
  const { lang, t, session, chains, chainsFailed = false, myTotalUsd6, next } = props;
  let body: React.ReactNode;
  if (!session) {
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-fg-muted">{t.connectHint}</p>
        <div>
          <PublicConnectLazy lang={lang} next={next} />
        </div>
      </div>
    );
  } else if (session.isMember) {
    body = (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-fg-muted">{t.memberText}</p>
        <Link
          href="/donar"
          className="inline-flex min-h-11 items-center gap-2 rounded-control bg-primary px-4 text-sm font-bold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <HeartHandshake aria-hidden className="size-4" />
          {t.memberLink}
        </Link>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-5">
        {myTotalUsd6 !== null ? (
          <dl className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-control bg-surface-2 p-3">
            <dt className="text-sm text-fg-muted">{t.myTotal}</dt>
            <dd className="font-mono text-base font-bold text-fg tabular-nums">{formatUsdIn(BigInt(myTotalUsd6), lang)}</dd>
          </dl>
        ) : null}
        <p className={NOTE}>
          <HeartHandshake aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t.mecenasNote}
        </p>
        {chainsFailed ? (
          <p role="alert" className="flex items-start gap-2 text-sm text-danger">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t.readFailed}
          </p>
        ) : chains.length === 0 ? (
          <div role="status" className="flex flex-col gap-1 rounded-control border border-border p-3">
            <p className="text-sm font-bold text-fg">{t.unavailable}</p>
            <p className="text-sm text-fg-muted">{t.unavailableText}</p>
          </div>
        ) : (
          <DonateFlow lang={lang} t={t} wallet={session.wallet} chains={chains} next={next} />
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {body}
      <Notices t={t} />
    </div>
  );
}

type Step = "form" | "attaching" | "attach-retry" | "verifying" | "done" | "failed";
type Phase = "idle" | "switching" | "preparing" | "checking" | "signing";

function DonateFlow({ lang, t, wallet, chains, next }: { lang: Lang; t: T; wallet: Hash; chains: readonly ChainId[]; next: string }) {
  const p = t.panel;
  const router = useRouter();
  const amountId = useId();
  const anonId = useId();
  const listedId = useId();
  const { open: openWallet } = useAppKit();
  const { address, chainId: walletChain, isConnected } = useAccount();
  const { ensure, switching } = useEnsureChain();
  const preflight = useBalancePreflight();
  const { send } = useSendTransfer();
  const invalidateBalances = useInvalidateAssetBalances();

  const errText = (code: string | undefined) => (code && code in p.errors ? p.errors[code as keyof typeof p.errors] : p.errors.generic);
  const fmt = (units: bigint, token: Token) => {
    const s = formatAmount(units, token);
    return lang === "en" ? s.replace(",", ".") : s;
  };

  const chainsKey = chains.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the list's content, not its identity
  const assets = useMemo(() => assetsFor(chains), [chainsKey]);
  const connected = isConnected && !!address;
  const sessionWallet = connected && address!.toLowerCase() === wallet.toLowerCase();
  const balances = useAssetBalances(assets, sessionWallet ? wallet : undefined);

  const [picked, setPicked] = useState<AssetId | null>(null);
  const [frozenAuto, setFrozenAuto] = useState<AssetId | null>(null);
  const bestNow = assets.length > 0 ? rankAssets(assets, balances, null)[0]!.id : null;
  const allKnown = assets.length > 0 && assets.every((a) => balances[a.id] !== null && balances[a.id] !== undefined);
  if (frozenAuto === null && allKnown && bestNow) setFrozenAuto(bestNow);
  const asset = assets.find((a) => a.id === picked) ?? assets.find((a) => a.id === (frozenAuto ?? bestNow)) ?? assets[0] ?? null;

  // This panel only renders in the browser (PublicDonatePanelLazy): a sent donation stored before a reload resumes here.
  const [flow, setFlow] = useState<Stored | null>(() => findStored(wallet));
  const [step, setStep] = useState<Step>(() => (flow ? (flow.attached ? "verifying" : "attaching") : "form"));
  const [phase, setPhase] = useState<Phase>("idle");
  const [amountText, setAmountText] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [listed, setListed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [waitingPrice, setWaitingPrice] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [pollRound, setPollRound] = useState(0);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Attach the stored hash to its intent (1 / 2 / 4 s between attempts), then verify.
  useEffect(() => {
    if (step !== "attaching" || !flow) return;
    let cancelled = false;
    void (async () => {
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        try {
          const r = await attachPublicDonationTxAction(flow.intentId, flow.hash);
          if (cancelled) return;
          if (r.ok || r.code === "tx_already_attached") {
            const done = { ...flow, attached: true };
            writeStored(wallet, done);
            setFlow(done);
            return setStep("verifying");
          }
          if (SESSION_CODES.has(r.code)) {
            setSignedOut(true);
            return setStep("attach-retry");
          }
          if (PERMANENT_ATTACH_CODES.has(r.code)) {
            clearStored(wallet, flow.intentId);
            setError(errText(r.code));
            return setStep("failed");
          }
        } catch {
          /* network or server-action error: retry */
        }
        if (cancelled) return;
        if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]!);
      }
      if (!cancelled) setStep("attach-retry");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per entry into the step
  }, [step, flow?.intentId]);

  // Verification: every 3 s for up to 2 min, then «taking long» with a manual check (the server keeps verifying too).
  useEffect(() => {
    if (step !== "verifying" || !flow) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const tick = async () => {
      const r: PublicVerifyResult = await verifyPublicDonationAction(flow.intentId).catch((): PublicVerifyResult => ({ status: "pending" }));
      if (cancelled) return;
      if (r.status === "confirmed") {
        clearStored(wallet, flow.intentId);
        invalidateBalances();
        router.refresh();
        return setStep("done");
      }
      // The session is gone: the hash stays stored and polling stops until the donor signs in again.
      if ((r.status === "pending" && r.reason === "not_authenticated") || (r.status === "failed" && SESSION_CODES.has(r.code))) {
        return setSignedOut(true);
      }
      if (r.status === "failed" && isDefinitiveFailure(r.code)) {
        clearStored(wallet, flow.intentId);
        setError(errText(r.code));
        return setStep("failed");
      }
      // A donation in ETH without a trusted price stays pending; it is never recorded with a doubtful one.
      if (r.status === "pending" && r.reason === "price_unavailable") setWaitingPrice(true);
      if (Date.now() - started >= POLL_WINDOW_MS) return setSlow(true);
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restarts on a manual check (pollRound)
  }, [step, flow?.intentId, pollRound]);

  const token: Token = asset?.token ?? "USDC";
  const chain: ChainId | null = asset?.chainId ?? null;
  const network = chain ? NETWORKS[chain].name : "";
  const units = parseAmount(amountText, token);
  const limits = TIP_LIMITS[token];
  let reason: string | null = null;
  if (amountText.trim() !== "" && units === null) reason = fill(p.amountInvalid, { decimals: TOKEN_DECIMALS[token] });
  else if (units !== null && (units < limits.min || units > limits.max)) reason = fill(p.amountRange, { min: fmt(limits.min, token), max: fmt(limits.max, token), token });

  const busy = phase !== "idle" || switching;
  const canDonate = sessionWallet && !!asset && units !== null && reason === null && !busy;
  const wrongNetwork = sessionWallet && chain !== null && walletChain !== chain;

  async function donate() {
    if (!canDonate || !asset || units === null) return;
    const chosen = { chain: asset.chainId, token: asset.token, amount: units };
    setError(null);
    const fail = (msg: string) => {
      setError(msg);
      setPhase("idle");
    };
    // A donation already sent from this browser is resumed, never sent twice.
    const pending = findStored(wallet);
    if (pending) {
      setFlow(pending);
      setPhase("idle");
      return setStep(pending.attached ? "verifying" : "attaching");
    }
    try {
      if (walletChain !== chosen.chain) {
        setPhase("switching");
        if (!(await ensure(chosen.chain))) return fail(fill(p.switchFailed, { network: NETWORKS[chosen.chain].name }));
      }
      setPhase("preparing");
      const created = await createPublicDonationIntentAction({ chainId: chosen.chain, token: chosen.token, amount: amountText.trim(), anonymous, listed: listed && !anonymous });
      if (!created.ok) return fail(errText(created.code));
      const it: TipIntent = created.intent;
      // What gets signed is one transfer with no fee, on the chosen network, for the typed amount, to the intent's recipient.
      if (it.chainId !== chosen.chain || it.token !== chosen.token || BigInt(it.amount) !== chosen.amount || BigInt(it.feeAmount) !== 0n || !/^0x[0-9a-fA-F]{40}$/.test(it.recipientAddress)) {
        return fail(p.mismatch);
      }
      setPhase("checking");
      const short = await preflight({ ...chosen, mainLabel: "la donación", account: wallet });
      if (!aliveRef.current) return;
      if (short) return fail(fill(p.insufficientSend, { network: NETWORKS[chosen.chain].name }));
      setPhase("signing");
      let hash: Hash;
      try {
        hash = await send({ ...chosen, to: it.recipientAddress as Hash, account: wallet });
      } catch (e) {
        return fail(isRejection(e) ? p.cancelled : p.sendFailed);
      }
      // The hash is stored before anything else: a reload from here on resumes verification instead of re-sending.
      const s: Stored = { intentId: it.id, chainId: chosen.chain, hash, attached: false };
      writeStored(wallet, s);
      setFlow(s);
      setPhase("idle");
      setSlow(false);
      setWaitingPrice(false);
      setStep("attaching");
    } catch {
      fail(p.errors.generic);
    }
  }

  function reset() {
    setFlow(null);
    setError(null);
    setSlow(false);
    setWaitingPrice(false);
    setSignedOut(false);
    setAmountText("");
    setStep("form");
  }

  const txLink =
    flow ? (
      <a
        href={explorerTx(flow.chainId, flow.hash)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center self-start rounded-control text-sm font-bold text-accent underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
      >
        {p.explorer}
      </a>
    ) : null;

  // The session expired after sending: the hash stays stored; signing in again reloads the page, which resumes it.
  if (signedOut && (step === "attaching" || step === "verifying" || step === "attach-retry")) {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="flex items-start gap-2 text-sm text-danger">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {p.signedOut}
        </p>
        {txLink}
        <div>
          <PublicConnectLazy lang={lang} next={next} />
        </div>
      </div>
    );
  }

  if (step === "attaching" || step === "verifying") {
    return (
      <div className="flex flex-col gap-3" aria-live="polite">
        {waitingPrice ? (
          <p className="flex items-start gap-2 text-sm text-fg">
            <Clock aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            {p.waitingPrice}
          </p>
        ) : slow ? (
          <p className="flex items-start gap-2 text-sm text-fg">
            <Clock aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            {p.slow}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-fg">
            <Loader2 aria-hidden className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
            {p.verifying}
          </p>
        )}
        {txLink}
        {slow ? (
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() => {
              setSlow(false);
              setPollRound((n) => n + 1);
            }}
          >
            <RefreshCw aria-hidden />
            {p.checkAgain}
          </Button>
        ) : null}
      </div>
    );
  }

  if (step === "attach-retry") {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="flex items-start gap-2 text-sm text-danger">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {p.attachFailed}
        </p>
        {txLink}
        <Button type="button" className="self-start" onClick={() => setStep("attaching")}>
          <RefreshCw aria-hidden />
          {p.retry}
        </Button>
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="flex flex-col gap-3" aria-live="polite">
        <p className="flex items-center gap-2 font-display text-lg font-bold text-fg">
          <CircleCheck aria-hidden className="size-5 shrink-0 text-success" />
          {p.done}
        </p>
        <p className="text-sm text-fg-muted">{p.doneText}</p>
        {txLink}
        <Button type="button" variant="outline" className="self-start" onClick={reset}>
          {p.again}
        </Button>
      </div>
    );
  }

  if (step === "failed") {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="flex items-start gap-2 text-sm text-danger">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
        {txLink}
        <Button type="button" variant="outline" className="self-start" onClick={reset}>
          {p.again}
        </Button>
      </div>
    );
  }

  const busyLabel = switching || phase === "switching" ? p.switching : phase === "preparing" ? p.preparing : phase === "checking" ? p.checking : phase === "signing" ? p.signing : null;

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void donate();
      }}
    >
      <AssetPicker
        assets={assets}
        balances={balances}
        amount={units}
        value={asset?.id ?? null}
        onChange={(id) => {
          setPicked(id);
          setError(null);
        }}
        label={p.assetLabel}
        balanceLabel={p.balance}
        unknownLabel={p.balanceUnknown}
        arbitrumNote={p.arbitrumNote}
      />

      <div className="flex flex-col gap-2">
        <label htmlFor={amountId} className="text-sm font-bold text-fg">
          {p.amountLabel}
        </label>
        <div className="flex items-center gap-2">
          <Input
            id={amountId}
            inputMode="decimal"
            autoComplete="off"
            placeholder={lang === "en" ? "0.00" : "0,00"}
            value={amountText}
            onChange={(e) => {
              setAmountText(e.target.value);
              setError(null);
            }}
            aria-invalid={reason !== null ? true : undefined}
            aria-describedby={reason ? `${amountId}-msg` : undefined}
            className="min-h-11 font-mono text-base"
          />
          <span className="font-mono text-sm text-fg-muted">{token}</span>
        </div>
        {reason ? (
          <p id={`${amountId}-msg`} aria-live="polite" className="text-sm text-danger">
            {reason}
          </p>
        ) : null}
      </div>

      <fieldset className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <Checkbox
              id={anonId}
              checked={anonymous}
              onCheckedChange={(v) => {
                setAnonymous(v === true);
                // An anonymous donation never appears in the club's list.
                if (v === true) setListed(false);
              }}
              aria-describedby={`${anonId}-hint`}
            />
            <label htmlFor={anonId} className="min-h-11 flex-1 content-center text-sm font-bold text-fg">
              {p.anonymous}
            </label>
          </div>
          <p id={`${anonId}-hint`} className="text-[13px] text-fg-muted">
            {p.anonymousHint}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <Checkbox
              id={listedId}
              checked={listed && !anonymous}
              disabled={anonymous}
              onCheckedChange={(v) => setListed(v === true)}
              aria-describedby={`${listedId}-hint`}
            />
            <label htmlFor={listedId} className={`min-h-11 flex-1 content-center text-sm font-bold ${anonymous ? "text-fg-muted" : "text-fg"}`}>
              {p.listed}
            </label>
          </div>
          <p id={`${listedId}-hint`} className="text-[13px] text-fg-muted">
            {p.listedHint}
          </p>
        </div>
      </fieldset>

      {asset && units !== null && reason === null ? (
        <div className="flex items-center gap-3 rounded-control bg-surface-2 p-3 text-sm">
          <AssetLogo token={asset.token} chainId={asset.chainId} size={32} />
          <p className="min-w-0 break-words font-mono font-bold text-fg">{fill(p.summary, { amount: fmt(units, token), token, network })}</p>
        </div>
      ) : null}

      {connected && !sessionWallet ? (
        <p className="flex items-start gap-2 text-sm text-warning">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          {fill(p.useWallet, { address: shortAddress(wallet) })}
        </p>
      ) : wrongNetwork ? (
        <p className="flex items-start gap-2 text-sm text-warning">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          {fill(p.wrongNetwork, { network })}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="flex items-start gap-2 text-sm text-danger">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      {connected ? (
        <Button type="submit" size="lg" disabled={!canDonate} aria-busy={busy || undefined} className="w-full">
          {busyLabel ? (
            <>
              <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
              {busyLabel}
            </>
          ) : (
            p.submit
          )}
        </Button>
      ) : (
        <Button type="button" size="lg" className="w-full" onClick={() => void openWallet()}>
          <Plug aria-hidden />
          {p.connect}
        </Button>
      )}
    </form>
  );
}
