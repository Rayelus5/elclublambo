"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAppKit, useAppKitState } from "@reown/appkit/react";
import { CircleAlert, CircleCheck, Clock, Loader2 } from "lucide-react";
import { useAccount } from "wagmi";
import { AssetLogo } from "@/components/economy/asset-logo";
import { AssetPicker } from "@/components/payments/asset-picker";
import { useEconomy } from "@/components/payments/economy-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { shortAddress } from "@/lib/auth/wallet";
import { createDonationIntentAction } from "@/lib/donations/actions";
import { assetId, assetsFor, rankAssets, type AssetId } from "@/lib/economy/assets";
import { explorerTx, NETWORKS, type ChainId } from "@/lib/economy/networks";
import { formatAmount, parseAmount, TIP_LIMITS, type Token } from "@/lib/payments/amounts";
import { useAssetBalances, useInvalidateAssetBalances } from "@/lib/payments/balances";
import type { ConfirmResult } from "@/lib/payments/confirm";
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
  type PendingSend,
} from "@/lib/payments/pending-sends";
import { formBalanceError, useBalancePreflight } from "@/lib/payments/preflight";
import { attachTxAction, verifyIntentAction, type TipIntent } from "@/lib/payments/tip-actions";
import { useEnsureChain } from "@/lib/payments/use-ensure-chain";
import { useSendTransfer } from "@/lib/payments/use-send-transfer";

// Same flow as the tip dialog (src/components/payments/tip-dialog.tsx): pick an asset, switch network on demand, one
// signature, attach with retries, verify. The payee is always the club Safe, which accepts every network in `chains`
// (donationChains(): the build's networks where the Safe exists, P1-R6), so no receive-network filter applies.

const POLL_MS = 3000;
const POLL_WINDOW_MS = 120_000;
const SWITCH_DEBOUNCE_MS = 300;
const RETRY_DELAYS_MS = [1000, 2000, 4000];

const MSG_CUSTODY = "ElClub. no custodia fondos: va directo a la Safe del club. Donar no da derechos económicos.";
const MSG_UNAVAILABLE = "Donaciones aún no disponibles";
const MSG_WAITING_PRICE = "Recibida. Esperando precio para registrarla.";
const MSG_CANCELLED = "Has cancelado la firma.";
const MSG_SEND_FAILED = "No se pudo enviar la transacción. Revisa tu wallet e inténtalo de nuevo.";
const MSG_MISMATCH = "Los datos del envío no coinciden. Recarga la página.";
const MSG_PREPARE = "No se pudo preparar la donación. Inténtalo de nuevo.";
const MSG_EXPIRED = "La operación ha caducado y no se puede completar. Inténtalo de nuevo.";
const LABEL = "Donación";

type Step = "form" | "signing" | "attach-retry" | "inflight" | "verifying" | "done" | "failed";
type Sent = Pick<PendingSend, "mainHash" | "mainAttached">;
type AttachResult = "ok" | "retry" | { permanent: string };

class SignGuardError extends Error {}
class ExpiredError extends Error {}
class AbortedError extends Error {}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isRejection(e: unknown): boolean {
  for (let cur: unknown = e, i = 0; cur && typeof cur === "object" && i < 4; i++) {
    const o = cur as { code?: unknown; message?: unknown; shortMessage?: unknown; cause?: unknown };
    if (o.code === 4001) return true;
    if (/reject|denied|cancel/i.test(`${String(o.shortMessage ?? "")} ${String(o.message ?? "")}`)) return true;
    cur = o.cause;
  }
  return false;
}

/** A donation ledger entry is keyed by its network: a signature still waiting in the wallet on any of `chains`. */
function inFlight(memberId: string, chains: readonly ChainId[]): PendingSend | undefined {
  for (const c of chains) {
    const f = findInFlight(memberId, "donation", String(c));
    if (f) return f;
  }
  return undefined;
}

/** The trigger button plus the dialog. `chains` empty: a disabled button that says donations are not open yet. */
export function DonateTrigger({ chains, autoOpen = false }: { chains: readonly ChainId[]; autoOpen?: boolean }) {
  const [open, setOpen] = useState(autoOpen && chains.length > 0);
  if (chains.length === 0) {
    return (
      <Button type="button" disabled>
        {MSG_UNAVAILABLE}
      </Button>
    );
  }
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        Donar a ElClub.
      </Button>
      {open ? <DonateDialog open onOpenChange={setOpen} chains={chains} /> : null}
    </>
  );
}

export function DonateDialog({ open, onOpenChange, chains }: { open: boolean; onOpenChange: (open: boolean) => void; chains: readonly ChainId[] }) {
  const { open: walletModalOpen } = useAppKitState();
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
          <DialogTitle className="font-display text-lg font-bold">Donar a ElClub.</DialogTitle>
          <DialogDescription>Va directo a la Safe del club.</DialogDescription>
        </DialogHeader>
        {askClose ? (
          <div role="alertdialog" aria-label="Confirmar cierre" className="flex flex-col gap-3 rounded-control border border-warning p-3">
            <p className="text-sm text-fg">¿Cerrar? Si ya firmaste, la donación se seguirá verificando.</p>
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
        {chains.length === 0 ? (
          <p role="status" className="rounded-control border border-border p-3 text-sm text-fg-muted">
            {MSG_UNAVAILABLE}
          </p>
        ) : (
          <DonateFlow chains={chains} busyRef={busyRef} onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DonateFlow({ chains, busyRef, onClose }: { chains: readonly ChainId[]; busyRef: { current: boolean }; onClose: () => void }) {
  const economy = useEconomy();
  const { memberId } = economy;
  const router = useRouter();

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

  const [initial] = useState<PendingSend | undefined>(() => {
    pruneUnsupportedSends(memberId);
    return inFlight(memberId, chains);
  });
  const flowRef = useRef<{ it: TipIntent; st: Sent } | null>(null);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const chainsKey = chains.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the list's content, not its identity
  const assets = useMemo(() => assetsFor(chains), [chainsKey]);

  const connected = account.isConnected && !!account.address;
  const sessionWallet = connected && account.address!.toLowerCase() === economy.wallet.toLowerCase();
  const balances = useAssetBalances(assets, sessionWallet ? (account.address as `0x${string}`) : undefined);

  const [picked, setPicked] = useState<AssetId | null>(null);
  const [frozenAuto, setFrozenAuto] = useState<AssetId | null>(null);
  const bestNow = assets.length > 0 ? rankAssets(assets, balances, null)[0]!.id : null;
  const allKnown = assets.length > 0 && assets.every((a) => balances[a.id] !== null && balances[a.id] !== undefined);
  if (frozenAuto === null && allKnown && bestNow) setFrozenAuto(bestNow);
  const auto = frozenAuto ?? bestNow;
  const asset = assets.find((a) => a.id === picked) ?? assets.find((a) => a.id === auto) ?? assets[0] ?? null;
  const token: Token = asset?.token ?? "USDC";
  const chainId: ChainId = asset?.chainId ?? chains[0]!;

  const [switchReq, setSwitchReq] = useState<{ chainId: ChainId; seq: number } | null>(null);
  const ensureRef = useRef(ensure);
  useEffect(() => {
    ensureRef.current = ensure;
  });
  useEffect(() => {
    if (!switchReq) return;
    const t = setTimeout(() => void ensureRef.current(switchReq.chainId), SWITCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [switchReq]);
  const autoSubmitRef = useRef<{ chainId: ChainId; assetId: AssetId; units: bigint } | null>(null);
  const pick = (id: AssetId) => {
    autoSubmitRef.current = null;
    setPicked(id);
    const a = assets.find((x) => x.id === id);
    if (a) setSwitchReq((prev) => ({ chainId: a.chainId, seq: (prev?.seq ?? 0) + 1 }));
  };

  const [amountText, setAmountText] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [step, setStep] = useState<Step>(initial ? "inflight" : "form");
  const [formError, setFormError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [intent, setIntent] = useState<TipIntent | null>(initial?.intent ?? null);
  const [mainHash, setMainHash] = useState<string | undefined>(undefined);
  const [slow, setSlow] = useState(false);
  const [waitingPrice, setWaitingPrice] = useState(false);

  useEffect(() => {
    busyRef.current = step === "signing" || step === "verifying";
    return () => {
      busyRef.current = false;
    };
  }, [step, busyRef]);

  // Verification: every 3 s for up to 2 min; after that the server keeps verifying on its own (PendingSendsSync, cron).
  useEffect(() => {
    if (step !== "verifying" || !intent) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const tick = async () => {
      const r: ConfirmResult = await verifyIntentAction(intent.id).catch((): ConfirmResult => ({ status: "pending" }));
      if (cancelled) return;
      if (r.status === "confirmed") {
        removeSend(memberId, intent.id);
        invalidateBalances();
        router.refresh();
        return setStep("done");
      }
      if (r.status === "failed" && isDefinitiveFailure(r.code)) {
        removeSend(memberId, intent.id);
        setFailure(r.error);
        return setStep("failed");
      }
      // Review Focus 1: an ETH donation without a trusted price stays pending; it is never credited with a doubtful one.
      if (r.status === "pending" && r.reason === "price_unavailable") setWaitingPrice(true);
      if (Date.now() - started >= POLL_WINDOW_MS) return setSlow(true);
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [step, intent, memberId, invalidateBalances, router]);

  const units = parseAmount(amountText, token);
  const limits = TIP_LIMITS[token];
  let reason: string | null = null;
  if (amountText.trim() !== "" && units === null) reason = `Introduce un importe válido (como mucho ${token === "ETH" ? 18 : 6} decimales).`;
  else if (units !== null && (units < limits.min || units > limits.max))
    reason = `El importe debe estar entre ${formatAmount(limits.min, token)} y ${formatAmount(limits.max, token)} ${token}.`;

  const wallet: "connect" | "mismatch" | "chain" | null = !connected ? "connect" : !sessionWallet ? "mismatch" : account.chainId !== chainId ? "chain" : null;
  const tokenBalance = asset ? (balances[asset.id] ?? null) : null;
  const gasBalance = balances[assetId("ETH", chainId)];
  const walletReady = wallet === null || wallet === "chain";
  const balanceError =
    units !== null && reason === null && walletReady && asset && tokenBalance !== null
      ? formBalanceError({ chain: chainId, token, amount: units, balance: tokenBalance, eth: gasBalance ?? 1n })
      : null;
  const canContinue = !!asset && units !== null && reason === null && balanceError === null && walletReady;

  function guardSigner(it: TipIntent) {
    const acc = accountRef.current;
    if (!acc.isConnected || !acc.address || acc.address.toLowerCase() !== economy.wallet.toLowerCase()) {
      throw new SignGuardError(`Conecta la wallet ${shortAddress(economy.wallet)} para enviar.`);
    }
    if (acc.chainId !== it.chainId) throw new SignGuardError(`Cambia tu wallet a ${NETWORKS[it.chainId as ChainId]?.name ?? "la red del envío"} para enviar.`);
  }

  /** What gets signed is one transfer, no fee, to the club Safe the forum knows for that network, on an offered network. */
  function guardIntent(it: TipIntent) {
    const safe = economy.safes[it.chainId as ChainId];
    if (!chains.includes(it.chainId as ChainId)) throw new SignGuardError(MSG_MISMATCH);
    if (BigInt(it.feeAmount) !== 0n) throw new SignGuardError(MSG_MISMATCH);
    if (!safe || it.recipientAddress.toLowerCase() !== safe.toLowerCase()) throw new SignGuardError(MSG_MISMATCH);
  }

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

  async function proceed(it: TipIntent, st: Sent) {
    flowRef.current = { it, st };
    setIntent(it);
    const chain = it.chainId as ChainId;
    const ensureEntry = () => {
      if (loadSends(memberId).some((e) => e.intentId === it.id)) return;
      upsertSend(memberId, {
        intentId: it.id,
        chainId: it.chainId,
        token: it.token,
        targetType: "donation",
        targetId: String(it.chainId),
        feeRequired: false,
        createdAt: Date.now(),
        intent: it,
        ...st,
      });
    };
    const commit = (patch: Partial<Sent>) => {
      Object.assign(st, patch);
      setMainHash(st.mainHash);
      ensureEntry();
      patchSend(memberId, it.id, patch);
    };
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
      removeSend(memberId, it.id);
      setFailure(a.permanent);
      setStep("failed");
      return true;
    };
    try {
      if (await attachPending()) return;
      if (!st.mainHash) {
        guardIntent(it);
        guardSigner(it);
        const short = await preflight({ chain, token: it.token, amount: BigInt(it.amount), mainLabel: "la donación", account: economy.wallet as `0x${string}` });
        if (!aliveRef.current) throw new AbortedError();
        if (short) throw new SignGuardError(short);
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
        commit({ mainHash: hash });
        if (await attachPending()) return;
      }
    } catch (e) {
      if (e instanceof AbortedError) return;
      if (st.mainHash) return setStep("attach-retry");
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

  /** Re-reads the ledger: a signature still pending in the wallet blocks a new intent. */
  function applyLedger(): boolean {
    const next = inFlight(memberId, chains);
    if (!next) {
      flowRef.current = null;
      setStep("form");
      return false;
    }
    setIntent(next.intent);
    setStep("inflight");
    return true;
  }

  async function submit() {
    if (!canContinue || units === null || !asset) return;
    const chosen = asset;
    setFormError(null);
    if (wallet === "chain") {
      const pending = { chainId: chosen.chainId, assetId: chosen.id, units };
      autoSubmitRef.current = pending;
      if (!(await ensure(pending.chainId)) && autoSubmitRef.current === pending) autoSubmitRef.current = null;
      return;
    }
    if (applyLedger()) return;
    setStep("signing");
    let created: Awaited<ReturnType<typeof createDonationIntentAction>>;
    try {
      created = await createDonationIntentAction({ chainId: chosen.chainId, token: chosen.token, amount: amountText.trim(), anonymous });
    } catch {
      setFormError(MSG_PREPARE);
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
    if (it.chainId !== chosen.chainId || it.token !== chosen.token || BigInt(it.amount) !== units) {
      setFormError(MSG_MISMATCH);
      return setStep("form");
    }
    await proceed(it, {});
  }

  function retryAttach() {
    const flow = flowRef.current;
    if (flow) void proceed(flow.it, flow.st);
  }

  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });
  const currentAssetId = asset?.id;
  useEffect(() => {
    const pending = autoSubmitRef.current;
    if (pending === null) return;
    if (currentAssetId !== pending.assetId || units !== pending.units) {
      autoSubmitRef.current = null;
      return;
    }
    if (account.chainId !== pending.chainId) return;
    autoSubmitRef.current = null;
    if (aliveRef.current) void submitRef.current();
  }, [account.chainId, currentAssetId, units]);

  const txChain = (intent?.chainId ?? chainId) as ChainId;

  if (step === "signing") {
    return (
      <div className="flex flex-col gap-4" aria-live="polite">
        <ol className="flex flex-col gap-2">
          <li className="flex min-h-11 items-center gap-3 rounded-control border border-accent px-3 text-fg">
            <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
            <span className="font-mono text-[13px]">{LABEL}</span>
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
        <TxLink chain={txChain} hash={mainHash} />
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
        {waitingPrice ? (
          <p className="flex items-center gap-2 text-sm text-fg">
            <Clock aria-hidden className="size-4 shrink-0 text-warning" />
            {MSG_WAITING_PRICE}
          </p>
        ) : slow ? (
          <p className="text-sm text-fg">Seguimos verificando. Puedes cerrar: la donación se registrará sola cuando se confirme.</p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-fg">
            <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
            Verificando la transacción en la red…
          </p>
        )}
        <TxLink chain={txChain} hash={mainHash} />
        {slow || waitingPrice ? (
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        ) : null}
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="flex flex-col gap-4" aria-live="polite">
        <p className="flex items-center gap-2 font-display text-lg font-bold text-fg">
          <CircleCheck aria-hidden className="size-5 text-success" />
          Donación registrada
        </p>
        <p className="text-sm text-fg-muted">Gracias por apoyar al club.</p>
        <TxLink chain={txChain} hash={mainHash} />
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
        <TxLink chain={txChain} hash={mainHash} />
        <Button variant="outline" onClick={onClose}>
          Cerrar
        </Button>
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
        <Button type="button" variant="outline" disabled={switching} onClick={() => void ensure(chainId)}>
          Cambiar a {NETWORKS[chainId].name}
        </Button>
      </WalletNotice>
    ) : null;

  const safe = economy.safes[chainId];

  return (
    <form
      className="grid gap-4 md:grid-cols-2 md:gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex min-w-0 flex-col gap-4">
        <AssetPicker assets={assets} balances={balances} amount={units} value={asset?.id ?? null} onChange={pick} />
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="donate-amount" className="text-sm font-bold text-fg">
            Importe
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="donate-amount"
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

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <Checkbox id="donate-anon" checked={anonymous} onCheckedChange={(v) => setAnonymous(v === true)} />
            <label htmlFor="donate-anon" className="min-h-11 flex-1 content-center text-sm font-bold text-fg">
              Donar de forma anónima
            </label>
          </div>
          <p className="text-[13px] text-fg-muted">Los demás verán «Anónimo». En la blockchain la transacción es pública.</p>
        </div>

        {asset ? (
          <div data-testid="donate-summary" className="flex items-center gap-3 rounded-control bg-surface-2 p-3 text-sm">
            <AssetLogo token={asset.token} chainId={asset.chainId} size={32} />
            <p className="min-w-0 break-words">
              <span className="text-fg-muted">Para la Safe del club{safe ? ` (${shortAddress(safe)})` : ""}: </span>
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

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="submit" disabled={!canContinue || switching}>
            Continuar
          </Button>
        </div>
      </div>
    </form>
  );
}

function WalletNotice({ children }: { children: ReactNode }) {
  return <div className="flex flex-col items-start gap-2 rounded-control border border-border p-3">{children}</div>;
}

function TxLink({ chain, hash }: { chain: ChainId; hash: string | undefined }) {
  if (!hash) return null;
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 text-sm">
      <span className="text-fg-muted">{LABEL}</span>
      <a
        href={explorerTx(chain, hash)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Ver en el explorador: donación"
        className="rounded-control font-bold text-accent underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
      >
        Ver en el explorador
      </a>
    </div>
  );
}
