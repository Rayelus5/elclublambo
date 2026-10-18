"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAppKit, useAppKitState } from "@reown/appkit/react";
import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { useAccount, useSwitchChain } from "wagmi";
import { HowItWorksLink } from "@/components/guide/how-it-works-link";
import { NetworkBadge } from "@/components/economy/network-badge";
import { MemberAvatar } from "@/components/members/member-avatar";
import { FeeControl } from "@/components/payments/fee-control";
import { useEconomy } from "@/components/payments/economy-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { shortAddress } from "@/lib/auth/wallet";
import { explorerTx, NETWORKS, type ChainId } from "@/lib/economy/networks";
import { mentionLabel, type MemberIdentity } from "@/lib/members/name";
import { feeFor, formatAmount, parseAmount, TIP_LIMITS, type Token } from "@/lib/payments/amounts";
import {
  EXPIRY_MARGIN_MS,
  findInFlight,
  findResumable,
  loadSends,
  patchSend,
  PERMANENT_ATTACH_CODES,
  remainingMs,
  removeSend,
  upsertSend,
  type PendingSend,
} from "@/lib/payments/pending-sends";
import { attachTxAction, createTipIntentAction, verifyIntentAction, type TipIntent } from "@/lib/payments/tip-actions";
import { useSendTransfer } from "@/lib/payments/use-send-transfer";
import { cn } from "@/lib/utils";

export type TipTarget = { type: "message"; messageId: string } | { type: "profile" };
export type TipRecipient = MemberIdentity & { id: string };

const POLL_MS = 3000;
const POLL_WINDOW_MS = 120_000;
const TOKENS: Token[] = ["USDC", "ETH"];

type Step = "form" | "signing" | "attach-retry" | "resume" | "inflight" | "verifying" | "done" | "failed";
type Hashes = { fee?: string; main?: string };
/** What has been signed and told to the server for one intent; mirrors the ledger entry. */
type Sent = Pick<PendingSend, "feeHash" | "mainHash" | "feeAttached" | "mainAttached">;

const RETRY_DELAYS_MS = [1000, 2000, 4000];
const MSG_CANCELLED = "Has cancelado la firma.";
const MSG_SEND_FAILED = "No se pudo enviar la transacción. Revisa tu wallet e inténtalo de nuevo.";
const MSG_MISMATCH = "Los datos del envío no coinciden. Recarga la página.";
const MSG_PREPARE = "No se pudo preparar la propina. Inténtalo de nuevo.";
const MSG_EXPIRED = "La operación ha caducado y no se puede completar. La comisión enviada no se puede reutilizar.";

/** A refusal to sign with a message for the member (wrong signer, intent that disagrees with what was shown). */
class SignGuardError extends Error {}
/** Less than the safety margin left on the server intent: a signature now could never be attached. */
class ExpiredError extends Error {}
/** The dialog was closed: no further signature may be requested. */
class AbortedError extends Error {}

type AttachResult = "ok" | "retry" | { permanent: string };
type Initial = { kind: "form" } | { kind: "inflight" | "resume" | "expired"; entry: PendingSend };

/** What the ledger says about this target: a pending signature, a fee waiting for its tip, an expired leftover or nothing. */
function evaluate(memberId: string, targetType: "message" | "profile", targetId: string): Initial {
  const flight = findInFlight(memberId, targetType, targetId);
  if (flight) return { kind: "inflight", entry: flight };
  const res = findResumable(memberId, targetType, targetId);
  if (res) return { kind: remainingMs(res.intent) < EXPIRY_MARGIN_MS ? "expired" : "resume", entry: res };
  return { kind: "form" };
}

const flowFromEntry = (e: PendingSend): { it: TipIntent; st: Sent } => ({
  it: e.intent,
  st: { feeHash: e.feeHash, mainHash: e.mainHash, feeAttached: e.feeAttached, mainAttached: e.mainAttached },
});

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
  recipient,
  open,
  onOpenChange,
}: {
  target: TipTarget;
  recipient: TipRecipient;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
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
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
        onInteractOutside={(e) => {
          if (walletModalOpen) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-bold">Dar propina</DialogTitle>
          <DialogDescription>Va directo a su wallet. La comisión de la plataforma se suma aparte.</DialogDescription>
        </DialogHeader>
        {askClose ? (
          <div role="alertdialog" aria-label="Confirmar cierre" className="flex flex-col gap-3 rounded-control border border-warning p-3">
            <p className="text-sm text-fg">¿Cerrar? Si ya firmaste, la propina se seguirá verificando.</p>
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
        <TipFlow target={target} recipient={recipient} busyRef={busyRef} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function TipFlow({ target, recipient, busyRef, onClose }: { target: TipTarget; recipient: TipRecipient; busyRef: { current: boolean }; onClose: () => void }) {
  const economy = useEconomy();
  const { memberId } = economy;
  const chainId = economy.activeChainId;
  const network = NETWORKS[chainId];
  const platform = economy.chains[chainId].platform;
  const targetId = target.type === "message" ? target.messageId : recipient.id;

  const account = useAccount();
  const accountRef = useRef(account);
  useEffect(() => {
    accountRef.current = account;
  });
  const { switchChain, isPending: switching } = useSwitchChain();
  const { open: openWallet } = useAppKit();
  const { send } = useSendTransfer();

  // The ledger decides how the dialog opens: a signature still pending, a fee waiting for its tip, or a fresh form.
  const [initial] = useState<Initial>(() => evaluate(memberId, target.type, targetId));
  const initialEntry = initial.kind === "form" ? null : initial.entry;
  const flowRef = useRef<{ it: TipIntent; st: Sent } | null>(initialEntry ? flowFromEntry(initialEntry) : null);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (initial.kind === "expired") removeSend(memberId, initial.entry.intentId);
  }, [initial, memberId]);

  const [token, setToken] = useState<Token>("USDC");
  const [amountText, setAmountText] = useState("");
  const [feeBps, setFeeBps] = useState(economy.minFeeBps);
  const [anonymous, setAnonymous] = useState(false);
  const [step, setStep] = useState<Step>(initial.kind === "form" ? "form" : initial.kind === "expired" ? "failed" : initial.kind);
  const [formError, setFormError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(initial.kind === "expired" ? MSG_EXPIRED : null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ index: number; total: number }>({ index: 1, total: 1 });
  const [intent, setIntent] = useState<TipIntent | null>(initialEntry?.intent ?? null);
  const [hashes, setHashes] = useState<Hashes>({ fee: initialEntry?.feeHash, main: initialEntry?.mainHash });
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
      if (r.status === "confirmed") {
        removeSend(memberId, intent.id);
        return setStep("done");
      }
      if (r.status === "failed") {
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
  }, [step, intent, memberId]);

  const units = parseAmount(amountText, token);
  const limits = TIP_LIMITS[token];
  const fee = units !== null ? feeFor(units, feeBps) : 0n;

  const self = recipient.walletAddress.toLowerCase() === economy.wallet.toLowerCase();
  let reason: string | null = null;
  if (self) reason = "No puedes enviarte una propina a ti mismo.";
  else if (amountText.trim() !== "" && units === null) reason = `Introduce un importe válido (como mucho ${token === "ETH" ? 18 : 6} decimales).`;
  else if (units !== null && (units < limits.min || units > limits.max))
    reason = `El importe debe estar entre ${formatAmount(limits.min, token)} y ${formatAmount(limits.max, token)} ${token}.`;
  else if (feeBps > 0 && !platform) reason = "La plataforma aún no tiene wallet configurada en esta red.";

  const connected = account.isConnected && !!account.address;
  const wallet: "connect" | "mismatch" | "chain" | null = !connected
    ? "connect"
    : account.address!.toLowerCase() !== economy.wallet.toLowerCase()
      ? "mismatch"
      : account.chainId !== chainId
        ? "chain"
        : null;

  const canContinue = units !== null && reason === null && wallet === null;

  /** Re-checked right before every signature: the connected account is still the session wallet, on the right chain. */
  function guardSigner(it: TipIntent) {
    const acc = accountRef.current;
    if (!acc.isConnected || !acc.address || acc.address.toLowerCase() !== economy.wallet.toLowerCase()) {
      throw new SignGuardError(`Conecta la wallet ${shortAddress(economy.wallet)} para enviar.`);
    }
    if (acc.chainId !== it.chainId) throw new SignGuardError(`Cambia tu wallet a ${NETWORKS[it.chainId as ChainId]?.name ?? "la red activa"} para enviar.`);
  }

  /** What the member was shown must be what gets signed: the intent's addresses are checked against the screen/config. */
  function guardIntent(it: TipIntent) {
    const feeRequired = BigInt(it.feeAmount) > 0n;
    if (it.recipientAddress.toLowerCase() !== recipient.walletAddress.toLowerCase()) throw new SignGuardError(MSG_MISMATCH);
    if (feeRequired && (!it.platformAddress || !economy.chains[it.chainId as ChainId]?.platform || it.platformAddress.toLowerCase() !== economy.chains[it.chainId as ChainId].platform!.toLowerCase())) {
      throw new SignGuardError(MSG_MISMATCH);
    }
  }

  /**
   * attachTxAction is idempotent for the same hash: up to 3 retries with 1 s, 2 s, 4 s backoff for network or unknown
   * errors. intent_expired, forbidden and not_found are permanent: no retry.
   */
  async function attachWithRetry(intentId: string, role: "fee" | "main", hash: string): Promise<AttachResult> {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const r = await attachTxAction(intentId, role, hash);
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
   * Drives one intent from whatever has been signed so far to verification: attach pending hashes, sign the fee if still
   * missing, sign the main transfer if still missing. Once anything is signed it never goes back to the form.
   */
  async function proceed(it: TipIntent, st: Sent, target_: { targetType: "message" | "profile"; targetId: string }) {
    flowRef.current = { it, st };
    setIntent(it);
    const feeRequired = BigInt(it.feeAmount) > 0n && !!it.platformAddress;
    const chain = it.chainId as ChainId;
    const ensureEntry = () => {
      if (loadSends(memberId).some((e) => e.intentId === it.id)) return;
      upsertSend(memberId, {
        intentId: it.id,
        chainId: it.chainId,
        token: it.token,
        targetType: target_.targetType,
        targetId: target_.targetId,
        feeRequired,
        createdAt: Date.now(),
        intent: it,
        ...st,
      });
    };
    const commit = (patch: Partial<Sent>) => {
      Object.assign(st, patch);
      ensureEntry();
      patchSend(memberId, it.id, patch);
      setHashes({ fee: st.feeHash, main: st.mainHash });
    };
    /** Returns true when the flow must stop here (state already set). */
    const stopOnAttach = (a: AttachResult): boolean => {
      if (a === "ok") return false;
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
    const attachPending = async (): Promise<AttachResult> => {
      for (const role of ["fee", "main"] as const) {
        const hash = st[`${role}Hash`];
        if (!hash || st[`${role}Attached`]) continue;
        const r = await attachWithRetry(it.id, role, hash);
        if (r !== "ok") return r;
        commit(role === "fee" ? { feeAttached: true } : { mainAttached: true });
      }
      return "ok";
    };
    const signed = () => !!st.feeHash || !!st.mainHash;
    /** One wallet request. Closed dialog: no request. While pending the ledger says so, so a reopen cannot start another. */
    const sendGuarded = async (to: string, amount: bigint): Promise<`0x${string}`> => {
      if (!aliveRef.current) throw new AbortedError();
      if (remainingMs(it) < EXPIRY_MARGIN_MS) throw new ExpiredError();
      guardIntent(it);
      guardSigner(it);
      ensureEntry();
      patchSend(memberId, it.id, { inFlight: Date.now() });
      try {
        return await send({ chain, token: it.token, to: to as `0x${string}`, amount, account: economy.wallet as `0x${string}` });
      } finally {
        patchSend(memberId, it.id, { inFlight: undefined });
      }
    };
    try {
      if (stopOnAttach(await attachPending())) return;
      if (feeRequired && !st.feeHash) {
        setStep("signing");
        setProgress({ index: 1, total: 2 });
        const hash = await sendGuarded(it.platformAddress!, BigInt(it.feeAmount));
        commit({ feeHash: hash }); // in the ledger before the server is told
        if (stopOnAttach(await attachPending())) return;
      }
      if (!st.mainHash) {
        setStep("signing");
        setProgress({ index: feeRequired ? 2 : 1, total: feeRequired ? 2 : 1 });
        const hash = await sendGuarded(it.recipientAddress, BigInt(it.amount));
        commit({ mainHash: hash });
        if (stopOnAttach(await attachPending())) return;
      }
    } catch (e) {
      if (e instanceof AbortedError) return;
      if (e instanceof ExpiredError) {
        removeSend(memberId, it.id);
        setFailure(MSG_EXPIRED);
        return setStep("failed");
      }
      const msg = e instanceof SignGuardError ? e.message : isRejection(e) ? MSG_CANCELLED : MSG_SEND_FAILED;
      if (!signed()) {
        // Nothing left the wallet: safe to start over.
        removeSend(memberId, it.id);
        setFormError(msg);
        return setStep("form");
      }
      // The fee is paid: the same intent is resumed, never a new one.
      setResumeError(msg);
      return setStep("resume");
    }
    if (aliveRef.current) setStep("verifying");
  }

  /** Re-reads the ledger and moves to the matching state; returns false when it is a fresh form. */
  function applyLedger(): boolean {
    const next = evaluate(memberId, target.type, targetId);
    if (next.kind === "form") {
      flowRef.current = null;
      setStep("form");
      return false;
    }
    flowRef.current = flowFromEntry(next.entry);
    setIntent(next.entry.intent);
    setHashes({ fee: next.entry.feeHash, main: next.entry.mainHash });
    if (next.kind === "expired") {
      removeSend(memberId, next.entry.intentId);
      setFailure(MSG_EXPIRED);
      setStep("failed");
    } else {
      setStep(next.kind);
    }
    return true;
  }

  async function submit() {
    if (!canContinue || units === null) return;
    setFormError(null);
    // No new intent while an unfinished one exists for this target.
    if (applyLedger()) return;
    setStep("signing");
    setProgress({ index: 1, total: 1 });
    let created: Awaited<ReturnType<typeof createTipIntentAction>>;
    try {
      created = await createTipIntentAction({
        targetType: target.type,
        targetId,
        token,
        amount: amountText.trim(),
        feeBps,
        anonymous,
      });
    } catch {
      // Nothing has been signed yet.
      setFormError(MSG_PREPARE);
      return setStep("form");
    }
    if (!created.ok) {
      setFormError(created.error);
      return setStep("form");
    }
    await proceed(created.intent, {}, { targetType: target.type, targetId });
  }

  function resume() {
    const flow = flowRef.current;
    if (!flow) return;
    setResumeError(null);
    void proceed(flow.it, flow.st, { targetType: target.type, targetId });
  }

  function cancelResume() {
    if (flowRef.current) removeSend(memberId, flowRef.current.it.id);
    onClose();
  }

  const walletNotice = (
    <>
      {wallet === "connect" ? (
        <WalletNotice>
          <Button type="button" variant="outline" onClick={() => void openWallet()}>
            Conectar wallet
          </Button>
        </WalletNotice>
      ) : null}
      {wallet === "mismatch" ? (
        <WalletNotice>
          <p className="text-sm text-warning">Conecta la wallet {shortAddress(economy.wallet)} para enviar.</p>
        </WalletNotice>
      ) : null}
      {wallet === "chain" ? (
        <WalletNotice>
          <p className="text-sm text-warning">Tu wallet está en otra red.</p>
          <Button type="button" variant="outline" disabled={switching} onClick={() => switchChain({ chainId })}>
            Cambiar a {network.name}
          </Button>
        </WalletNotice>
      ) : null}
    </>
  );

  if (step === "signing") {
    const steps = progress.total === 2 ? ["Comisión", "Propina"] : ["Propina"];
    return (
      <div className="flex flex-col gap-4" aria-live="polite">
        <ol className="flex flex-col gap-2">
          {steps.map((label, i) => {
            const n = i + 1;
            const state = n < progress.index ? "done" : n === progress.index ? "current" : "next";
            return (
              <li key={label} className={cn("flex min-h-11 items-center gap-3 rounded-control border px-3", state === "current" ? "border-accent text-fg" : "border-border text-fg-muted")}>
                {state === "done" ? (
                  <CircleCheck aria-hidden className="size-4 text-success" />
                ) : state === "current" ? (
                  <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
                ) : (
                  <span aria-hidden className="size-4" />
                )}
                <span className="font-mono text-[13px]">{progress.total === 2 ? `${n}/2 ${label}` : label}</span>
              </li>
            );
          })}
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

  if (step === "resume") {
    const it = intent;
    return (
      <div className="flex flex-col gap-4">
        <NetworkBadge chainId={(it?.chainId ?? chainId) as ChainId} className="self-start" />
        <div className="flex items-center gap-3 rounded-control border border-border p-3">
          <MemberAvatar member={recipient} size={32} />
          <div className="min-w-0">
            <p className="truncate font-bold text-fg">{mentionLabel(recipient)}</p>
            <p className="font-mono text-[13px] text-fg-muted">{shortAddress(recipient.walletAddress)}</p>
          </div>
        </div>
        <p className="text-sm font-bold text-fg">La comisión ya está pagada. Falta firmar la propina.</p>
        {it ? (
          <p className="font-mono text-sm text-fg" data-testid="resume-amount">
            Falta: {formatAmount(BigInt(it.amount), it.token)} {it.token} para {mentionLabel(recipient)}
          </p>
        ) : null}
        {resumeError ? (
          <p role="alert" className="text-sm text-danger">
            {resumeError}
          </p>
        ) : null}
        {walletNotice}
        <TxLinks chain={(it?.chainId ?? chainId) as ChainId} hashes={hashes} />
        <p className="text-[13px] text-warning">Si cancelas, la comisión enviada no se devolverá y la propina no se acreditará.</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={resume} disabled={wallet !== null}>
            Firmar la propina
          </Button>
          <Button variant="outline" onClick={cancelResume}>
            Cancelar
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
        <TxLinks chain={(intent?.chainId ?? chainId) as ChainId} hashes={hashes} />
        <div className="flex flex-wrap gap-2">
          <Button onClick={resume}>Reintentar</Button>
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
          <p className="text-sm text-fg">Seguimos verificando. Puedes cerrar: la propina se acreditará sola cuando se confirme.</p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-fg">
            <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
            Verificando la transacción en la red…
          </p>
        )}
        <TxLinks chain={(intent?.chainId ?? chainId) as ChainId} hashes={hashes} />
        {slow ? <Button variant="outline" onClick={onClose}>Cerrar</Button> : null}
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="flex flex-col gap-4" aria-live="polite">
        <p className="flex items-center gap-2 font-display text-lg font-bold text-fg">
          <CircleCheck aria-hidden className="size-5 text-success" />
          Propina enviada
        </p>
        <TxLinks chain={(intent?.chainId ?? chainId) as ChainId} hashes={hashes} />
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
        <TxLinks chain={(intent?.chainId ?? chainId) as ChainId} hashes={hashes} />
        <Button variant="outline" onClick={onClose}>Cerrar</Button>
      </div>
    );
  }

  const total = units !== null ? units + fee : null;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <NetworkBadge chainId={chainId} className="self-start" />

      <div className="flex items-center gap-3 rounded-control border border-border p-3">
        <MemberAvatar member={recipient} size={32} />
        <div className="min-w-0">
          <p className="truncate font-bold text-fg">{mentionLabel(recipient)}</p>
          <p className="font-mono text-[13px] text-fg-muted">{shortAddress(recipient.walletAddress)}</p>
        </div>
      </div>

      <div role="radiogroup" aria-label="Moneda" className="grid grid-cols-2 gap-1 rounded-control border border-border-strong p-1">
        {TOKENS.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={token === t}
            onClick={() => setToken(t)}
            className={cn(
              "min-h-11 rounded-control text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-accent",
              token === t ? "bg-accent text-bg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            {t}
          </button>
        ))}
      </div>

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
      </div>

      <FeeControl minBps={economy.minFeeBps} value={feeBps} onChange={setFeeBps} />

      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-control bg-surface-2 p-3 text-sm">
        <dt className="text-fg-muted">Para {mentionLabel(recipient)}</dt>
        <dd className="font-mono text-fg">{units !== null ? `${formatAmount(units, token)} ${token}` : "—"}</dd>
        <dt className="text-fg-muted">Comisión</dt>
        <dd className="font-mono text-fg">{units !== null ? `${formatAmount(fee, token)} ${token}` : "—"}</dd>
        <dt className="font-bold text-fg">Total</dt>
        <dd className="font-mono font-bold text-fg" data-testid="tip-total">
          {total !== null ? `${formatAmount(total, token)} ${token}` : "—"}
        </dd>
      </dl>

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <Checkbox id="tip-anon" checked={anonymous} onCheckedChange={(v) => setAnonymous(v === true)} />
          <label htmlFor="tip-anon" className="min-h-11 flex-1 content-center text-sm font-bold text-fg">
            Propina anónima
          </label>
        </div>
        <p className="text-[13px] text-fg-muted">Solo se oculta en el foro: en la blockchain la transacción es pública.</p>
      </div>

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
        <HowItWorksLink section="propinas" />
        <Button type="submit" disabled={!canContinue}>
          Continuar
        </Button>
      </div>
    </form>
  );
}

function WalletNotice({ children }: { children: ReactNode }) {
  return <div className="flex flex-col items-start gap-2 rounded-control border border-border p-3">{children}</div>;
}

function TxLinks({ chain, hashes }: { chain: ChainId; hashes: Hashes }) {
  const rows = [
    ["Comisión", hashes.fee],
    ["Propina", hashes.main],
  ] as const;
  const shown = rows.filter(([, h]) => !!h);
  if (shown.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {shown.map(([label, hash]) => (
        <li key={label} className="flex min-h-11 items-center justify-between gap-3 text-sm">
          <span className="text-fg-muted">{label}</span>
          <a
            href={explorerTx(chain, hash!)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Ver en el explorador: ${label.toLowerCase()}`}
            className="rounded-control font-bold text-accent underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
          >
            Ver en el explorador
          </a>
        </li>
      ))}
    </ul>
  );
}
