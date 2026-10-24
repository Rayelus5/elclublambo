"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAppKit, useAppKitState } from "@reown/appkit/react";
import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { useAccount } from "wagmi";
import { AssetLogo } from "@/components/economy/asset-logo";
import { HowItWorksLink } from "@/components/guide/how-it-works-link";
import { MemberAvatar } from "@/components/members/member-avatar";
import { AssetPicker } from "@/components/payments/asset-picker";
import { useEconomy } from "@/components/payments/economy-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { shortAddress } from "@/lib/auth/wallet";
import { createBountyPaymentIntentAction } from "@/lib/bounties/actions";
import { assetId, assetsFor, rankAssets, type AssetId } from "@/lib/economy/assets";
import { chainForKey, explorerTx, NETWORKS, type ChainId, type NetworkKey } from "@/lib/economy/networks";
import { mentionLabel, type MemberIdentity } from "@/lib/members/name";
import { formatAmount, parseAmount, TIP_LIMITS, type Token } from "@/lib/payments/amounts";
import { useAssetBalances, useInvalidateAssetBalances } from "@/lib/payments/balances";
import { isDefinitiveFailure } from "@/lib/payments/outcomes";
import {
  EXPIRY_MARGIN_MS,
  findInFlight,
  loadSends,
  patchSend,
  PERMANENT_ATTACH_CODES,
  pruneUnsupportedSends,
  remainingMs,
  removeSend,
  upsertSend,
  type LedgerTargetType,
  type PendingSend,
} from "@/lib/payments/pending-sends";
import { formBalanceError, useBalancePreflight } from "@/lib/payments/preflight";
import { getReceiveNetworks } from "@/lib/payments/queries";
import { attachTxAction, createTipIntentAction, verifyIntentAction, type TipIntent } from "@/lib/payments/tip-actions";
import { useEnsureChain } from "@/lib/payments/use-ensure-chain";
import { useSendTransfer } from "@/lib/payments/use-send-transfer";
import { createBrowserClient } from "@/lib/supabase/browser";

export type TipTarget = { type: "message"; messageId: string } | { type: "profile" };
export type TipRecipient = MemberIdentity & { id: string };
/**
 * Pays a bounty to the solution's author (`solverId`): the token is the bounty's, the amount cannot go below the
 * announced one and there is no anonymity. `chainId` is the announced network (P0-R4): offered first, but any enabled
 * network the solver accepts can carry the same token.
 */
export type BountyMode = { kind: "bounty"; bountyId: string; token: Token; minAmount: bigint; chainId: ChainId; solverId: string };

const POLL_MS = 3000;
const POLL_WINDOW_MS = 120_000;
/** Wait after the last selection change before asking the wallet to switch: arrow keys must not prompt once per row. */
const SWITCH_DEBOUNCE_MS = 300;
const ALL_NETWORKS: NetworkKey[] = ["base", "arbitrum"];

type Step = "form" | "signing" | "attach-retry" | "inflight" | "verifying" | "done" | "failed";
/** What has been signed and told to the server for one intent; mirrors the ledger entry. */
type Sent = Pick<PendingSend, "mainHash" | "mainAttached">;

const RETRY_DELAYS_MS = [1000, 2000, 4000];
const MSG_CANCELLED = "Has cancelado la firma.";
const MSG_SEND_FAILED = "No se pudo enviar la transacción. Revisa tu wallet e inténtalo de nuevo.";
const MSG_MISMATCH = "Los datos del envío no coinciden. Recarga la página.";
const MSG_PREPARE = "No se pudo preparar la propina. Inténtalo de nuevo.";
const MSG_PREPARE_BOUNTY = "No se pudo preparar el pago. Inténtalo de nuevo.";
const MSG_PREPARED_OTHER_AMOUNT = "Ya tenías un pago de este bounty preparado con otro importe. Revisa el formulario y continúa.";
const MSG_EXPIRED = "La operación ha caducado y no se puede completar. Inténtalo de nuevo.";
const MSG_NO_COMMON_NETWORK = "Esta persona no recibe pagos en las redes disponibles.";
const MSG_CUSTODY = "ElClub. no custodia fondos: va directo a su wallet.";

/** A refusal to sign with a message for the member (wrong signer, intent that disagrees with what was shown). */
class SignGuardError extends Error {}
/** Less than the safety margin left on the server intent: a signature now could never be attached. */
class ExpiredError extends Error {}
/** The dialog was closed: no further signature may be requested. */
class AbortedError extends Error {}

type AttachResult = "ok" | "retry" | { permanent: string };
type Initial = { kind: "form" } | { kind: "inflight"; entry: PendingSend };

/** What the ledger says about this target: a signature that may still be waiting in the wallet, or nothing. */
function evaluate(memberId: string, targetType: LedgerTargetType, targetId: string): Initial {
  const flight = findInFlight(memberId, targetType, targetId);
  return flight ? { kind: "inflight", entry: flight } : { kind: "form" };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Wallets reject with code 4001 or a message saying so; anything else is a different failure. */
function isRejection(e: unknown): boolean {
  for (let cur: unknown = e, i = 0; cur && typeof cur === "object" && i < 4; i++) {
    const o = cur as { code?: unknown; message?: unknown; shortMessage?: unknown; cause?: unknown };
    if (o.code === 4001) return true;
    if (/reject|denied|cancel/i.test(`${String(o.shortMessage ?? "")} ${String(o.message ?? "")}`)) return true;
    cur = o.cause;
  }
  return false;
}

export function TipDialog({
  target,
  mode,
  recipient,
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipient: TipRecipient;
} & ({ target: TipTarget; mode?: undefined } | { mode: BountyMode; target?: undefined })) {
  // The AppKit modal lives outside this dialog: while it is open, the dialog must not trap pointer or focus nor close.
  const { open: walletModalOpen } = useAppKitState();
  // Set by the flow while a signature or a verification is in flight: closing then asks first.
  const busyRef = useRef(false);
  const [askClose, setAskClose] = useState(false);
  return (
    <Dialog
      open={open}
      modal={!walletModalOpen}
      onOpenChange={(next) => {
        if (next) return onOpenChange(true);
        if (busyRef.current) return setAskClose(true);
        onOpenChange(false);
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md md:max-w-3xl"
        onInteractOutside={(e) => {
          if (walletModalOpen) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-bold">{mode ? "Pagar bounty" : "Dar propina"}</DialogTitle>
          <DialogDescription>{mode ? "Va directo a la wallet de quien dio la solución." : "Va directo a su wallet."}</DialogDescription>
        </DialogHeader>
        {askClose ? (
          <div role="alertdialog" aria-label="Confirmar cierre" className="flex flex-col gap-3 rounded-control border border-warning p-3">
            <p className="text-sm text-fg">¿Cerrar? Si ya firmaste, {mode ? "el pago" : "la propina"} se seguirá verificando.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setAskClose(false)}>
                Seguir aquí
              </Button>
              <Button
                onClick={() => {
                  setAskClose(false);
                  onOpenChange(false);
                }}
              >
                Cerrar
              </Button>
            </div>
          </div>
        ) : null}
        <TipFlow target={target} mode={mode} recipient={recipient} busyRef={busyRef} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function TipFlow({
  target,
  mode,
  recipient,
  busyRef,
  onClose,
}: {
  target?: TipTarget;
  mode?: BountyMode;
  recipient: TipRecipient;
  busyRef: { current: boolean };
  onClose: () => void;
}) {
  const economy = useEconomy();
  const { memberId, enabledChainIds } = economy;
  // The ledger is keyed by what is being paid: a bounty by its message id, a tip by its message or the profile.
  const ledgerType: LedgerTargetType = mode ? "bounty" : (target?.type ?? "profile");
  const targetId = mode ? mode.bountyId : target?.type === "message" ? target.messageId : recipient.id;
  const mainLabel = mode ? "Pago" : "Propina";
  const theMain = mode ? "el pago" : "la propina";
  const payeeName = mentionLabel(recipient);

  const account = useAccount();
  const accountRef = useRef(account);
  useEffect(() => {
    accountRef.current = account;
  });
  const { open: openWallet } = useAppKit();
  const { send } = useSendTransfer();
  const preflight = useBalancePreflight();
  const invalidateBalances = useInvalidateAssetBalances();
  const { ensure, switching, failedFor } = useEnsureChain();

  // Leftovers that can never complete (fee era, disabled chain) go first (Review Focus 4); then the ledger decides how
  // the dialog opens: a signature still pending in the wallet, or a fresh form.
  const [initial] = useState<Initial>(() => {
    pruneUnsupportedSends(memberId, enabledChainIds);
    return evaluate(memberId, ledgerType, targetId);
  });
  const flowRef = useRef<{ it: TipIntent; st: Sent } | null>(null);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // The networks the payee accepts (P0-R7). Null while loading.
  const payeeId = mode ? mode.solverId : recipient.id;
  const [accept, setAccept] = useState<NetworkKey[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    getReceiveNetworks(createBrowserClient(), payeeId)
      .catch(() => ALL_NETWORKS)
      .then((keys) => {
        if (!cancelled) setAccept(keys);
      });
    return () => {
      cancelled = true;
    };
  }, [payeeId]);

  // A bounty is paid in its own token only, on whichever accepted network carries it.
  const bountyToken = mode?.token;
  const assets = useMemo(() => {
    if (!accept) return [];
    const all = assetsFor(enabledChainIds, accept);
    return bountyToken ? all.filter((a) => a.token === bountyToken) : all;
  }, [accept, enabledChainIds, bountyToken]);

  const connected = account.isConnected && !!account.address;
  const sessionWallet = connected && account.address!.toLowerCase() === economy.wallet.toLowerCase();
  const balances = useAssetBalances(assets, sessionWallet ? (account.address as `0x${string}`) : undefined);

  // Selection: the member's explicit pick, else (a bounty) the announced network, else the best payable asset. The
  // automatic pick follows the balances until all of them are known, then stays put (it never moves under the member
  // while typing).
  const [picked, setPicked] = useState<AssetId | null>(null);
  const [frozenAuto, setFrozenAuto] = useState<AssetId | null>(null);
  const bestNow = assets.length > 0 ? rankAssets(assets, balances, null)[0]!.id : null;
  const allKnown = assets.length > 0 && assets.every((a) => balances[a.id] !== null && balances[a.id] !== undefined);
  // Adjusting state while rendering (not in an effect): React re-renders this component before painting.
  if (frozenAuto === null && allKnown && bestNow) setFrozenAuto(bestNow);
  const auto = frozenAuto ?? bestNow;
  const announced = mode ? assets.find((a) => a.chainId === mode.chainId) : undefined;
  const asset = assets.find((a) => a.id === picked) ?? announced ?? assets.find((a) => a.id === auto) ?? assets[0] ?? null;
  const token: Token = asset?.token ?? mode?.token ?? "USDC";
  const chainId: ChainId = asset?.chainId ?? mode?.chainId ?? enabledChainIds[0] ?? chainForKey("base");

  // An explicit pick asks the wallet to move to that asset's network once the selection settles (click, Enter or the
  // last arrow key), never once per row while arrowing through the list.
  const [switchReq, setSwitchReq] = useState<{ chainId: ChainId; seq: number } | null>(null);
  const ensureRef = useRef(ensure);
  useEffect(() => {
    ensureRef.current = ensure;
  });
  useEffect(() => {
    if (!switchReq) return;
    const t = setTimeout(() => ensureRef.current(switchReq.chainId), SWITCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [switchReq]);
  const pick = (id: AssetId) => {
    setPicked(id);
    const a = assets.find((x) => x.id === id);
    if (a) setSwitchReq((prev) => ({ chainId: a.chainId, seq: (prev?.seq ?? 0) + 1 }));
  };

  const [amountText, setAmountText] = useState(mode ? formatAmount(mode.minAmount, mode.token) : "");
  const [anonymous, setAnonymous] = useState(false);
  const [step, setStep] = useState<Step>(initial.kind);
  const [formError, setFormError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [intent, setIntent] = useState<TipIntent | null>(initial.kind === "inflight" ? initial.entry.intent : null);
  const [mainHash, setMainHash] = useState<string | undefined>(undefined);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    busyRef.current = step === "signing" || step === "verifying";
    return () => {
      busyRef.current = false;
    };
  }, [step, busyRef]);

  // Verification: ask the server every 3 s for up to 2 min; after that it keeps verifying on its own.
  useEffect(() => {
    if (step !== "verifying" || !intent) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const tick = async () => {
      const r = await verifyIntentAction(intent.id).catch(() => ({ status: "pending" }) as const);
      if (cancelled) return;
      if (r.status === "confirmed" || r.status === "pending_finality") {
        removeSend(memberId, intent.id);
        invalidateBalances();
        return setStep("done");
      }
      // F3-R3: only a definitive failure ends the flow; anything else (a transient error) keeps polling.
      if (r.status === "failed" && isDefinitiveFailure(r.code)) {
        removeSend(memberId, intent.id);
        setFailure(r.error);
        return setStep("failed");
      }
      if (Date.now() - started >= POLL_WINDOW_MS) return setSlow(true);
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [step, intent, memberId, invalidateBalances]);

  const units = parseAmount(amountText, token);
  const limits = TIP_LIMITS[token];
  const noCommonNetwork = accept !== null && assets.length === 0;

  const self = recipient.walletAddress.toLowerCase() === economy.wallet.toLowerCase();
  let reason: string | null = null;
  if (self) reason = "No puedes enviarte una propina a ti mismo.";
  else if (amountText.trim() !== "" && units === null) reason = `Introduce un importe válido (como mucho ${token === "ETH" ? 18 : 6} decimales).`;
  else if (units !== null && mode && units < mode.minAmount)
    reason = `El importe no puede ser menor que el del bounty (${formatAmount(mode.minAmount, token)} ${token}).`;
  else if (units !== null && (units < limits.min || units > limits.max))
    reason = `El importe debe estar entre ${formatAmount(limits.min, token)} y ${formatAmount(limits.max, token)} ${token}.`;

  const wallet: "connect" | "mismatch" | "chain" | null = !connected ? "connect" : !sessionWallet ? "mismatch" : account.chainId !== chainId ? "chain" : null;

  const tokenBalance = asset ? (balances[asset.id] ?? null) : null;
  const gasBalance = balances[assetId("ETH", chainId)];
  // Before any intent exists: the amount (and ETH for gas) against what the wallet holds. Unreadable balance: no opinion.
  const balanceError =
    units !== null && reason === null && wallet === null && asset && tokenBalance !== null
      ? formBalanceError({ chain: chainId, token, amount: units, balance: tokenBalance, eth: gasBalance ?? 1n })
      : null;

  const canContinue = !!asset && units !== null && reason === null && balanceError === null && wallet === null;

  /** Re-checked right before the signature: the connected account is still the session wallet, on the intent's chain. */
  function guardSigner(it: TipIntent) {
    const acc = accountRef.current;
    if (!acc.isConnected || !acc.address || acc.address.toLowerCase() !== economy.wallet.toLowerCase()) {
      throw new SignGuardError(`Conecta la wallet ${shortAddress(economy.wallet)} para enviar.`);
    }
    if (acc.chainId !== it.chainId) throw new SignGuardError(`Cambia tu wallet a ${NETWORKS[it.chainId as ChainId]?.name ?? "la red del envío"} para enviar.`);
  }

  /** What the member was shown must be what gets signed: one transfer, no fee, to the recipient on screen. */
  function guardIntent(it: TipIntent) {
    // A bounty intent must be the bounty's token, on a network offered here, for at least the announced amount.
    if (mode && (it.token !== mode.token || !assets.some((a) => a.chainId === it.chainId) || BigInt(it.amount) < mode.minAmount)) {
      throw new SignGuardError(MSG_MISMATCH);
    }
    if (BigInt(it.feeAmount) !== 0n) throw new SignGuardError(MSG_MISMATCH);
    if (it.recipientAddress.toLowerCase() !== recipient.walletAddress.toLowerCase()) throw new SignGuardError(MSG_MISMATCH);
  }

  /**
   * attachTxAction is idempotent for the same hash: up to 3 retries with 1 s, 2 s, 4 s backoff for network or unknown
   * errors. intent_expired, forbidden and not_found are permanent: no retry.
   */
  async function attachWithRetry(intentId: string, hash: string): Promise<AttachResult> {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const r = await attachTxAction(intentId, "main", hash);
        if (r.ok) return "ok";
        if (PERMANENT_ATTACH_CODES.has(r.code)) return { permanent: r.error };
      } catch {
        /* network or server-action error: retry */
      }
      if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]!);
    }
    return "retry";
  }

  /**
   * Drives one intent from whatever has been done so far to verification: sign the single transfer if still missing,
   * then attach its hash. Once signed it never goes back to the form.
   */
  async function proceed(it: TipIntent, st: Sent, target_: { targetType: LedgerTargetType; targetId: string }) {
    flowRef.current = { it, st };
    setIntent(it);
    const chain = it.chainId as ChainId;
    const ensureEntry = () => {
      if (loadSends(memberId).some((e) => e.intentId === it.id)) return;
      upsertSend(memberId, {
        intentId: it.id,
        chainId: it.chainId,
        token: it.token,
        targetType: target_.targetType,
        targetId: target_.targetId,
        feeRequired: false,
        createdAt: Date.now(),
        intent: it,
        ...st,
      });
    };
    const commit = (patch: Partial<Sent>) => {
      Object.assign(st, patch);
      ensureEntry();
      patchSend(memberId, it.id, patch);
      setMainHash(st.mainHash);
    };
    /** Returns true when the flow must stop here (state already set). */
    const attachPending = async (): Promise<boolean> => {
      if (!st.mainHash || st.mainAttached) return false;
      const a = await attachWithRetry(it.id, st.mainHash);
      if (a === "ok") {
        commit({ mainAttached: true });
        return false;
      }
      if (a === "retry") {
        setStep("attach-retry");
        return true;
      }
      // Permanent: nothing more can be done with this intent, so the entry must not be retried forever.
      removeSend(memberId, it.id);
      setFailure(a.permanent);
      setStep("failed");
      return true;
    };
    try {
      if (await attachPending()) return;
      if (!st.mainHash) {
        // Balance check right before the signature, on the intent's chain. A failed read never blocks.
        guardIntent(it);
        guardSigner(it);
        const short = await preflight({ chain, token: it.token, amount: BigInt(it.amount), mainLabel: theMain, account: economy.wallet as `0x${string}` });
        if (!aliveRef.current) throw new AbortedError();
        if (short) throw new SignGuardError(short);
        // One wallet request. Closed dialog: no request. While pending the ledger says so, so a reopen cannot start another.
        if (remainingMs(it) < EXPIRY_MARGIN_MS) throw new ExpiredError();
        guardIntent(it);
        guardSigner(it);
        setStep("signing");
        ensureEntry();
        patchSend(memberId, it.id, { inFlight: Date.now() });
        let hash: `0x${string}`;
        try {
          hash = await send({ chain, token: it.token, to: it.recipientAddress as `0x${string}`, amount: BigInt(it.amount), account: economy.wallet as `0x${string}` });
        } finally {
          patchSend(memberId, it.id, { inFlight: undefined });
        }
        commit({ mainHash: hash }); // in the ledger before the server is told
        if (await attachPending()) return;
      }
    } catch (e) {
      if (e instanceof AbortedError) return;
      // Something was signed: the entry stays and the flow can only go on attaching it, never back to the form.
      if (st.mainHash) return setStep("attach-retry");
      // Nothing left the wallet in any of these: safe to start over.
      removeSend(memberId, it.id);
      if (e instanceof ExpiredError) {
        setFailure(MSG_EXPIRED);
        return setStep("failed");
      }
      setFormError(e instanceof SignGuardError ? e.message : isRejection(e) ? MSG_CANCELLED : MSG_SEND_FAILED);
      return setStep("form");
    }
    if (aliveRef.current) setStep("verifying");
  }

  /** Re-reads the ledger and moves to the matching state; returns false when it is a fresh form. */
  function applyLedger(): boolean {
    const next = evaluate(memberId, ledgerType, targetId);
    if (next.kind === "form") {
      flowRef.current = null;
      setStep("form");
      return false;
    }
    setIntent(next.entry.intent);
    setStep("inflight");
    return true;
  }

  async function submit() {
    if (!canContinue || units === null || !asset) return;
    const chosen = asset;
    setFormError(null);
    // No new intent while a signature for this target may still be pending.
    if (applyLedger()) return;
    setStep("signing");
    let created: { ok: true; intent: TipIntent } | { ok: false; error: string };
    try {
      created = mode
        ? await createBountyPaymentIntentAction({ bountyId: mode.bountyId, chainId: chosen.chainId, amount: amountText.trim() })
        : await createTipIntentAction({
            targetType: target?.type === "message" ? "message" : "profile",
            targetId,
            chainId: chosen.chainId,
            token: chosen.token,
            amount: amountText.trim(),
            anonymous,
          });
    } catch {
      // Nothing has been signed yet.
      setFormError(mode ? MSG_PREPARE_BOUNTY : MSG_PREPARE);
      return setStep("form");
    }
    if (!created.ok) {
      setFormError(created.error);
      return setStep("form");
    }
    const it = created.intent;
    try {
      guardIntent(it);
    } catch (e) {
      setFormError(e instanceof SignGuardError ? e.message : MSG_MISMATCH);
      return setStep("form");
    }
    // What was shown is what gets signed: the chosen asset (token and network) and the amount.
    if (it.chainId !== chosen.chainId || it.token !== chosen.token) {
      setFormError(MSG_MISMATCH);
      return setStep("form");
    }
    if (BigInt(it.amount) !== units) {
      if (!mode) {
        setFormError(MSG_MISMATCH);
        return setStep("form");
      }
      // The server hands back the bounty's existing unattached intent when there is one. It must be what the member sees.
      setAmountText(formatAmount(BigInt(it.amount), token));
      setFormError(MSG_PREPARED_OTHER_AMOUNT);
      return setStep("form");
    }
    await proceed(it, {}, { targetType: ledgerType, targetId });
  }

  function retryAttach() {
    const flow = flowRef.current;
    if (!flow) return;
    void proceed(flow.it, flow.st, { targetType: ledgerType, targetId });
  }

  const txChain = (intent?.chainId ?? chainId) as ChainId;

  if (step === "signing") {
    return (
      <div className="flex flex-col gap-4" aria-live="polite">
        <ol className="flex flex-col gap-2">
          <li className="flex min-h-11 items-center gap-3 rounded-control border border-accent px-3 text-fg">
            <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
            <span className="font-mono text-[13px]">{mainLabel}</span>
          </li>
        </ol>
        <p className="text-sm text-fg-muted">Confirma en tu wallet.</p>
      </div>
    );
  }

  if (step === "inflight") {
    return (
      <div className="flex flex-col gap-4" aria-live="polite">
        <p className="text-sm font-bold text-fg">Tienes una firma pendiente en tu wallet. Complétala o recházala antes de continuar.</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void applyLedger()}>Comprobar de nuevo</Button>
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    );
  }

  if (step === "attach-retry") {
    return (
      <div className="flex flex-col gap-4">
        <p role="alert" className="flex items-start gap-2 text-sm text-danger">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          No hemos podido registrar tu transacción.
        </p>
        <TxLink chain={txChain} hash={mainHash} label={mainLabel} />
        <div className="flex flex-wrap gap-2">
          <Button onClick={retryAttach}>Reintentar</Button>
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    );
  }

  if (step === "verifying") {
    return (
      <div className="flex flex-col gap-4" aria-live="polite">
        {slow ? (
          <p className="text-sm text-fg">
            Seguimos verificando. Puedes cerrar: {mode ? "el pago se acreditará solo" : "la propina se acreditará sola"} cuando se confirme.
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-fg">
            <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
            Verificando la transacción en la red…
          </p>
        )}
        <TxLink chain={txChain} hash={mainHash} label={mainLabel} />
        {slow ? <Button variant="outline" onClick={onClose}>Cerrar</Button> : null}
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="flex flex-col gap-4" aria-live="polite">
        <p className="flex items-center gap-2 font-display text-lg font-bold text-fg">
          <CircleCheck aria-hidden className="size-5 text-success" />
          {mode ? "Bounty pagado" : "Propina enviada"}
        </p>
        <TxLink chain={txChain} hash={mainHash} label={mainLabel} />
        <Button onClick={onClose}>Cerrar</Button>
      </div>
    );
  }

  if (step === "failed") {
    return (
      <div className="flex flex-col gap-4">
        <p role="alert" className="flex items-start gap-2 text-sm text-danger">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {failure}
        </p>
        <TxLink chain={txChain} hash={mainHash} label={mainLabel} />
        <Button variant="outline" onClick={onClose}>Cerrar</Button>
      </div>
    );
  }

  const walletNotice =
    wallet === "connect" ? (
      <WalletNotice>
        <Button type="button" variant="outline" onClick={() => void openWallet()}>
          Conectar wallet
        </Button>
      </WalletNotice>
    ) : wallet === "mismatch" ? (
      <WalletNotice>
        <p className="text-sm text-warning">Conecta la wallet {shortAddress(economy.wallet)} para enviar.</p>
      </WalletNotice>
    ) : wallet === "chain" && asset ? (
      <WalletNotice>
        <p className="text-sm text-warning">Tu wallet está en otra red.</p>
        {failedFor === chainId ? <p className="text-[13px] text-fg-muted">No se pudo cambiar de red. Cámbiala desde tu wallet o inténtalo otra vez.</p> : null}
        <Button type="button" variant="outline" disabled={switching} onClick={() => ensure(chainId)}>
          Cambiar a {NETWORKS[chainId].name}
        </Button>
      </WalletNotice>
    ) : null;

  return (
    <form
      className="grid gap-4 md:grid-cols-2 md:gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {/* Desktop: who and with what on the left; how much, the summary and the confirmation on the right. */}
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex items-center gap-3 rounded-control border border-border p-3">
          <MemberAvatar member={recipient} size={32} />
          <div className="min-w-0">
            <p className="truncate font-bold text-fg">{payeeName}</p>
            <p className="font-mono text-[13px] text-fg-muted">{shortAddress(recipient.walletAddress)}</p>
          </div>
        </div>

        {accept === null ? (
          <div aria-busy="true" className="flex min-h-24 items-center gap-2 rounded-control border border-border p-3 text-sm text-fg-muted">
            <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
            Cargando monedas…
          </div>
        ) : noCommonNetwork ? (
          <p role="alert" className="rounded-control border border-warning p-3 text-sm text-warning">
            {MSG_NO_COMMON_NETWORK}
          </p>
        ) : mode ? (
          <>
            <p data-testid="locked-token" className="text-sm text-fg-muted">
              Moneda del bounty: <span className="font-mono font-bold text-fg">{mode.token}</span>
            </p>
            <AssetPicker assets={assets} balances={balances} amount={units} value={asset?.id ?? null} onChange={pick} label="Red de pago" />
          </>
        ) : (
          <AssetPicker assets={assets} balances={balances} amount={units} value={asset?.id ?? null} onChange={pick} />
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="tip-amount" className="text-sm font-bold text-fg">
            Importe
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="tip-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              aria-invalid={reason !== null && amountText.trim() !== "" ? true : undefined}
              className="font-mono"
            />
            <span className="font-mono text-sm text-fg-muted">{token}</span>
          </div>
          {balanceError ? (
            <p role="alert" data-testid="balance-error" className="text-sm text-danger">
              {balanceError}
            </p>
          ) : null}
        </div>

        {mode ? null : (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <Checkbox id="tip-anon" checked={anonymous} onCheckedChange={(v) => setAnonymous(v === true)} />
              <label htmlFor="tip-anon" className="min-h-11 flex-1 content-center text-sm font-bold text-fg">
                Propina anónima
              </label>
            </div>
            <p className="text-[13px] text-fg-muted">Solo se oculta en el foro: en la blockchain la transacción es pública.</p>
          </div>
        )}

        {asset ? (
          <div data-testid="tip-summary" className="flex items-center gap-3 rounded-control bg-surface-2 p-3 text-sm">
            <AssetLogo token={asset.token} chainId={asset.chainId} size={32} />
            <p className="min-w-0 break-words">
              <span className="text-fg-muted">Para {payeeName}: </span>
              <span className="font-mono font-bold text-fg">{units !== null ? `${formatAmount(units, token)} ${token}` : "—"}</span>
            </p>
          </div>
        ) : null}
        <p className="text-[13px] text-fg-muted">{MSG_CUSTODY}</p>

        {reason ? (
          <p aria-live="polite" className="text-sm text-danger">
            {reason}
          </p>
        ) : null}
        {formError ? (
          <p role="alert" className="text-sm text-danger">
            {formError}
          </p>
        ) : null}

        {walletNotice}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <HowItWorksLink section={mode ? "bounties" : "propinas"} />
          {noCommonNetwork ? null : (
            <Button type="submit" disabled={!canContinue}>
              Continuar
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}

function WalletNotice({ children }: { children: ReactNode }) {
  return <div className="flex flex-col items-start gap-2 rounded-control border border-border p-3">{children}</div>;
}

function TxLink({ chain, hash, label }: { chain: ChainId; hash: string | undefined; label: string }) {
  if (!hash) return null;
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 text-sm">
      <span className="text-fg-muted">{label}</span>
      <a
        href={explorerTx(chain, hash)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Ver en el explorador: ${label.toLowerCase()}`}
        className="rounded-control font-bold text-accent underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
      >
        Ver en el explorador
      </a>
    </div>
  );
}
