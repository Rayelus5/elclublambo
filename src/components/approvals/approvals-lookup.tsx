"use client";

import { useId, useState, type FormEvent } from "react";
import { CircleAlert, Search, Wallet } from "lucide-react";
import { NetworkPicker } from "@/components/economy/network-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ADDRESS_RE } from "@/lib/checker/input";
import { NETWORKS, type ChainId, type NetworkKey } from "@/lib/economy/networks";
import type { Dictionary } from "@/lib/i18n";
import { useWalletMatch } from "@/lib/web3/use-wallet-match";

export type ApprovalsLookupError = "invalid";

/**
 * GET form of the approvals tool (`?address=…&chain=base|arbitrum`, so a review is a shareable URL): the address, the
 * network chips and, with a wallet connected, «Usar mi wallet» to fill in its address. A malformed address is caught
 * here before the round trip; the server validates again. «Revisar» is the screen's primary fill only while there is
 * no list (`primary`); below a list it steps back to outline so the row being revoked is the one fill.
 */
export function ApprovalsLookup({
  t,
  action,
  chains,
  defaultValue,
  defaultChain,
  error,
  primary,
}: {
  t: Dictionary["approvals"]["lookup"];
  action: string;
  chains: readonly ChainId[];
  defaultValue: string;
  defaultChain: NetworkKey;
  error: ApprovalsLookupError | null;
  primary: boolean;
}) {
  const id = useId();
  const { address } = useWalletMatch(null);
  const [value, setValue] = useState(defaultValue);
  const [chain, setChain] = useState<ChainId>(() => chains.find((c) => NETWORKS[c].key === defaultChain) ?? chains[0]!);
  const [localError, setLocalError] = useState<ApprovalsLookupError | null>(null);
  const [edited, setEdited] = useState(false);
  const shown = localError ?? (edited ? null : error);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    if (!ADDRESS_RE.test(value.trim())) {
      e.preventDefault();
      setLocalError("invalid");
    }
  }

  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <form method="get" action={action} onSubmit={onSubmit} noValidate role="search" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-q`} className="text-sm font-bold text-fg">
          {t.label}
        </label>
        <Input
          id={`${id}-q`}
          name="address"
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setEdited(true);
            setLocalError(null);
          }}
          placeholder="0x…"
          maxLength={64}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          required
          aria-invalid={shown ? true : undefined}
          aria-describedby={shown ? `${errorId} ${hintId}` : hintId}
          className="font-mono"
        />
        {shown ? (
          <p id={errorId} role="alert" className="flex items-start gap-2 text-sm text-danger">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t[shown]}
          </p>
        ) : null}
        <p id={hintId} className="text-sm text-fg-muted">
          {t.hint}
        </p>
        {address && address.toLowerCase() !== value.trim().toLowerCase() ? (
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() => {
              setValue(address);
              setEdited(true);
              setLocalError(null);
            }}
          >
            <Wallet aria-hidden />
            {t.useWallet}
          </Button>
        ) : null}
      </div>
      <NetworkPicker value={chain} onChange={setChain} chains={chains} label={t.network} />
      <input type="hidden" name="chain" value={NETWORKS[chain].key} />
      <Button type="submit" variant={primary ? "default" : "outline"} className="self-start">
        <Search aria-hidden />
        {t.submit}
      </Button>
    </form>
  );
}
