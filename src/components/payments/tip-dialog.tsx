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
import { attachTxAction, createTipIntentAction, verifyIntentAction, type TipIntent } from "@/lib/payments/tip-actions";
import { useSendTransfer } from "@/lib/payments/use-send-transfer";
import { cn } from "@/lib/utils";

export type TipTarget = { type: "message"; messageId: string } | { type: "profile" };
export type TipRecipient = MemberIdentity & { id: string };

const POLL_MS = 3000;
const POLL_WINDOW_MS = 120_000;
const TOKENS: Token[] = ["USDC", "ETH"];

type Step = "form" | "signing" | "verifying" | "done" | "failed";
type Hashes = { fee?: string; main?: string };

class AttachError extends Error {}

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
  const lockedRef = useRef(false);
  return (
    <Dialog
      open={open}
      modal={!walletModalOpen}
      onOpenChange={(next) => {
        if (!next && lockedRef.current) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
        onInteractOutside={(e) => {
          if (walletModalOpen || lockedRef.current) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (lockedRef.current) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-bold">Dar propina</DialogTitle>
          <DialogDescription>Va directo a su wallet. La comisión de la plataforma se suma aparte.</DialogDescription>
        </DialogHeader>
        <TipFlow target={target} recipient={recipient} lockedRef={lockedRef} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function TipFlow({ target, recipient, lockedRef, onClose }: { target: TipTarget; recipient: TipRecipient; lockedRef: { current: boolean }; onClose: () => void }) {
  const economy = useEconomy();
  const chainId = economy.activeChainId;
  const network = NETWORKS[chainId];
  const platform = economy.chains[chainId].platform;

  const account = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { open: openWallet } = useAppKit();
  const { send } = useSendTransfer();

  const [token, setToken] = useState<Token>("USDC");
  const [amountText, setAmountText] = useState("");
  const [feeBps, setFeeBps] = useState(economy.minFeeBps);
  const [anonymous, setAnonymous] = useState(false);
  const [step, setStep] = useState<Step>("form");
  const [formError, setFormError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ index: number; total: number }>({ index: 1, total: 1 });
  const [intent, setIntent] = useState<TipIntent | null>(null);
  const [hashes, setHashes] = useState<Hashes>({});
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    lockedRef.current = step === "signing";
    return () => {
      lockedRef.current = false;
    };
  }, [step, lockedRef]);

  // Verification: ask the server every 3 s for up to 2 min; after that it keeps verifying on its own.
  useEffect(() => {
    if (step !== "verifying" || !intent) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const tick = async () => {
      const r = await verifyIntentAction(intent.id).catch(() => ({ status: "pending" }) as const);
      if (cancelled) return;
      if (r.status === "confirmed") return setStep("done");
      if (r.status === "failed") {
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
  }, [step, intent]);

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

  async function submit() {
    if (!canContinue || units === null) return;
    setFormError(null);
    setStep("signing");
    setProgress({ index: 1, total: 1 });
    const created = await createTipIntentAction({
      targetType: target.type,
      targetId: target.type === "message" ? target.messageId : recipient.id,
      token,
      amount: amountText.trim(),
      feeBps,
      anonymous,
    });
    if (!created.ok) {
      setFormError(created.error);
      return setStep("form");
    }
    const it = created.intent;
    setIntent(it);
    const chain = it.chainId as ChainId;
    const feeAmount = BigInt(it.feeAmount);
    const total = feeAmount > 0n && it.platformAddress ? 2 : 1;
    const got: Hashes = {};
    const attach = async (role: "fee" | "main", hash: `0x${string}`) => {
      got[role] = hash;
      setHashes({ ...got });
      const r = await attachTxAction(it.id, role, hash);
      if (!r.ok) throw new AttachError(r.error);
    };
    try {
      if (total === 2) {
        setProgress({ index: 1, total });
        await attach("fee", await send({ chain, token: it.token, to: it.platformAddress as `0x${string}`, amount: feeAmount }));
      }
      setProgress({ index: total, total });
      await attach("main", await send({ chain, token: it.token, to: it.recipientAddress as `0x${string}`, amount: BigInt(it.amount) }));
    } catch (e) {
      if (e instanceof AttachError) {
        setFailure(e.message);
        return setStep("failed");
      }
      setFormError(isRejection(e) ? "Has cancelado la firma." : "No se pudo enviar la transacción. Revisa tu wallet e inténtalo de nuevo.");
      return setStep("form");
    }
    setStep("verifying");
  }

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
        <p className="text-sm text-fg-muted">Confirma en tu wallet. No cierres esta ventana.</p>
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
        <p role="alert" className="text-sm text-danger">
          {reason}
        </p>
      ) : null}
      {formError ? (
        <p role="alert" className="text-sm text-danger">
          {formError}
        </p>
      ) : null}

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
