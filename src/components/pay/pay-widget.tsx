"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppKit } from "@reown/appkit/react";
import { CircleAlert, Info, Loader2, Plug, ShieldCheck } from "lucide-react";
import { useAccount } from "wagmi";
import { AssetLogo } from "@/components/economy/asset-logo";
import { AssetPicker } from "@/components/payments/asset-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { assetId, assetsFor, rankAssets, type AssetId } from "@/lib/economy/assets";
import { chainsForSet, networkSet, NETWORKS, type ChainId, type NetworkKey } from "@/lib/economy/networks";
import type { Dictionary, Lang } from "@/lib/i18n";
import { fill } from "@/lib/i18n/fill";
import { localizedPath } from "@/lib/i18n/routes";
import { formatAmount, parseAmount, TIP_LIMITS, TOKEN_DECIMALS, type Token } from "@/lib/payments/amounts";
import { useAssetBalances, useInvalidateAssetBalances } from "@/lib/payments/balances";
import { useBalancePreflight } from "@/lib/payments/preflight";
import { useEnsureChain } from "@/lib/payments/use-ensure-chain";
import { useSendTransfer } from "@/lib/payments/use-send-transfer";

type Props = {
  lang: Lang;
  t: Dictionary["pay"]["page"];
  /** The recipient's address (the transfer goes straight here). */
  to: `0x${string}`;
  /** Networks the recipient accepts (D22): only their assets are offered. */
  accept: readonly NetworkKey[];
  initialAmount: string | null;
  initialAsset: AssetId | null;
};

type Phase = "idle" | "switching" | "checking" | "signing" | "redirecting";

function isRejection(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: string; code?: number; cause?: unknown };
  if (e.name === "UserRejectedRequestError" || e.code === 4001) return true;
  return e.cause ? isRejection(e.cause) : false;
}

/**
 * Session-less payment (P3-R1): connect a wallet, pick an asset of an accepted network, type an amount, pay. One
 * transfer from the payer's wallet to `to`; before the signature the wallet is moved to the asset's chain and the balance
 * (and gas for USDC) is read on that chain. Nothing is sent when the check fails.
 */
export function PayWidget({ lang, t, to, accept, initialAmount, initialAsset }: Props) {
  const router = useRouter();
  const amountId = useId();
  const { open: openWallet } = useAppKit();
  const { address, chainId: walletChain, isConnected } = useAccount();
  const { ensure, switching } = useEnsureChain();
  const preflight = useBalancePreflight();
  const { send } = useSendTransfer();
  const invalidateBalances = useInvalidateAssetBalances();

  const fmt = (units: bigint, token: Token) => {
    const s = formatAmount(units, token);
    return lang === "en" ? s.replace(",", ".") : s;
  };

  const assets = useMemo(() => assetsFor(chainsForSet(networkSet()), accept), [accept]);
  const connected = isConnected && !!address;
  const payer = connected ? (address as `0x${string}`) : undefined;
  const balances = useAssetBalances(assets, payer);

  // The link's asset, else the payer's explicit pick, else the best payable one; the automatic pick follows the balances
  // until all are known, then stays put (it never moves under the payer while typing).
  const [picked, setPicked] = useState<AssetId | null>(() => (initialAsset && assets.some((a) => a.id === initialAsset) ? initialAsset : null));
  const [frozenAuto, setFrozenAuto] = useState<AssetId | null>(null);
  const bestNow = assets.length > 0 ? rankAssets(assets, balances, null)[0]!.id : null;
  const allKnown = assets.length > 0 && assets.every((a) => balances[a.id] !== null && balances[a.id] !== undefined);
  if (frozenAuto === null && allKnown && bestNow) setFrozenAuto(bestNow);
  const asset = assets.find((a) => a.id === picked) ?? assets.find((a) => a.id === (frozenAuto ?? bestNow)) ?? assets[0] ?? null;

  const [amountText, setAmountText] = useState(initialAmount ?? "");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const token: Token = asset?.token ?? "USDC";
  const chain: ChainId | null = asset?.chainId ?? null;
  const network = chain ? NETWORKS[chain].name : "";
  const units = parseAmount(amountText, token);
  const limits = TIP_LIMITS[token];
  const self = connected && address!.toLowerCase() === to.toLowerCase();

  let reason: string | null = null;
  if (self) reason = t.self;
  else if (amountText.trim() !== "" && units === null) reason = fill(t.amountInvalid, { decimals: TOKEN_DECIMALS[token] });
  else if (units !== null && (units < limits.min || units > limits.max))
    reason = fill(t.amountRange, { min: fmt(limits.min, token), max: fmt(limits.max, token), token });

  // Inline hint from the balances already read (the authoritative check runs again right before the signature).
  let balanceHint: string | null = null;
  if (asset && chain && units !== null && reason === null) {
    const bal = balances[asset.id];
    const gas = balances[assetId("ETH", chain)];
    if (bal !== null && bal !== undefined) {
      const short = token === "USDC" ? bal < units : bal <= units;
      if (short) balanceHint = fill(t.insufficient, { amount: fmt(units, token), token, network, have: fmt(bal, token) });
      else if (token === "USDC" && gas === 0n) balanceHint = fill(t.noGas, { network });
    }
  }

  const busy = phase !== "idle" || switching;
  const canPay = connected && !!asset && units !== null && reason === null && !busy;
  const wrongNetwork = connected && chain !== null && walletChain !== chain;

  async function pay() {
    if (!canPay || !asset || units === null || !payer) return;
    const target = { chain: asset.chainId, token: asset.token, amount: units };
    setError(null);
    try {
      // Review Focus 2: the wallet goes to the asset's chain first, then the flow goes on by itself.
      if (walletChain !== target.chain) {
        setPhase("switching");
        if (!(await ensure(target.chain))) {
          setError(fill(t.switchFailed, { network: NETWORKS[target.chain].name }));
          return setPhase("idle");
        }
      }
      setPhase("checking");
      const short = await preflight({ ...target, mainLabel: "el pago", account: payer });
      if (short) {
        setError(fill(t.insufficientSend, { network: NETWORKS[target.chain].name }));
        return setPhase("idle");
      }
      setPhase("signing");
      const hash = await send({ ...target, to, account: payer });
      invalidateBalances();
      setPhase("redirecting");
      router.push(localizedPath(lang, "payReceipt", { chainId: target.chain, hash }));
    } catch (e) {
      setError(isRejection(e) ? t.cancelled : t.sendFailed);
      setPhase("idle");
    }
  }

  const busyLabel =
    phase === "switching" || switching ? t.switching : phase === "checking" ? t.checking : phase === "signing" || phase === "redirecting" ? t.signing : null;

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void pay();
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
        label={t.assetLabel}
        balanceLabel={t.balance}
        unknownLabel={t.balanceUnknown}
        arbitrumNote={t.arbitrumNote}
      />

      <div className="flex flex-col gap-2">
        <label htmlFor={amountId} className="text-sm font-bold text-fg">
          {t.amountLabel}
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
            aria-invalid={reason !== null && amountText.trim() !== "" ? true : undefined}
            aria-describedby={reason || balanceHint ? `${amountId}-msg` : undefined}
            className="min-h-11 font-mono text-base"
          />
          <span className="font-mono text-sm text-fg-muted">{token}</span>
        </div>
        {reason || balanceHint ? (
          <p id={`${amountId}-msg`} aria-live="polite" className="text-sm text-danger">
            {reason ?? balanceHint}
          </p>
        ) : null}
      </div>

      {asset && units !== null && reason === null ? (
        <div className="flex items-center gap-3 rounded-control bg-surface-2 p-3 text-sm">
          <AssetLogo token={asset.token} chainId={asset.chainId} size={32} />
          <p className="min-w-0 break-words font-mono font-bold text-fg">
            {fill(t.summary, { amount: fmt(units, token), token, network })}
          </p>
        </div>
      ) : null}

      {wrongNetwork ? (
        <p className="flex items-start gap-2 text-sm text-warning">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          {fill(t.wrongNetwork, { network })}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="flex items-start gap-2 text-sm text-danger">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      {connected ? (
        <Button type="submit" size="lg" disabled={!canPay} aria-busy={busy || undefined} className="w-full">
          {busyLabel ? (
            <>
              <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
              {busyLabel}
            </>
          ) : (
            t.pay
          )}
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <Button type="button" size="lg" className="w-full" onClick={() => void openWallet()}>
            <Plug aria-hidden />
            {t.connect}
          </Button>
          <p className="text-[13px] text-fg-muted">{t.connectHint}</p>
        </div>
      )}

      <p className="flex items-start gap-2 text-[13px] text-fg-muted">
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
        {t.noCustody}
      </p>
    </form>
  );
}
