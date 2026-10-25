"use client";

import { useState } from "react";
import { AssetLogo } from "@/components/economy/asset-logo";
import { Input } from "@/components/ui/input";
import { parseAssetId, type AssetId } from "@/lib/economy/assets";
import { NETWORKS } from "@/lib/economy/networks";
import type { Dictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { buildPayUrl, parsePayQuery } from "@/lib/pay/link";
import { CopyButton } from "./copy-button";

type Tool = Dictionary["pay"]["tool"];

/** The payment link of the profile: optional amount and asset (only those of the networks the profile receives on), then copy. */
export function LinkBuilder({ lang, t, alias, origin, assetIds }: { lang: Lang; t: Tool; alias: string; origin: string; assetIds: readonly AssetId[] }) {
  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState<AssetId | "">("");
  const [touched, setTouched] = useState(false);

  const query = parsePayQuery({ amount: amount.trim() || undefined, asset: asset || undefined });
  const amountInvalid = amount.trim() !== "" && query.amount === null;
  const url = buildPayUrl(origin, lang, alias, { amount: query.amount ?? undefined, asset: query.asset ?? undefined });
  const options = assetIds.flatMap((id) => {
    const a = parseAssetId(id);
    return a ? [a] : [];
  });
  const row = "flex min-h-11 cursor-pointer items-center gap-3 rounded-control border border-border px-3 has-checked:border-accent";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <label htmlFor="pay-amount" className="text-sm font-bold text-fg">
          {t.amountLabel}
        </label>
        <Input
          id="pay-amount"
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={touched && amountInvalid ? true : undefined}
          aria-describedby={touched && amountInvalid ? "pay-amount-hint pay-amount-err" : "pay-amount-hint"}
        />
        <p id="pay-amount-hint" className="text-[13px] text-fg-muted">
          {t.amountHint}
        </p>
        {touched && amountInvalid ? (
          <p id="pay-amount-err" role="alert" className="text-sm text-danger">
            {t.amountInvalid}
          </p>
        ) : null}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-bold text-fg">{t.assetLabel}</legend>
        <label className={row}>
          <input type="radio" name="pay-asset" value="" checked={asset === ""} onChange={() => setAsset("")} className="size-5 accent-accent" />
          <span className="text-base text-fg">{t.assetAny}</span>
        </label>
        {options.map((a) => (
          <label key={a.id} className={row}>
            <input type="radio" name="pay-asset" value={a.id} checked={asset === a.id} onChange={() => setAsset(a.id)} className="size-5 accent-accent" />
            <AssetLogo token={a.token} chainId={a.chainId} size={24} />
            <span className="text-base text-fg">
              {a.token} · {NETWORKS[a.chainId].name}
            </span>
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor="pay-link" className="text-sm font-bold text-fg">
          {t.yourLink}
        </label>
        <Input id="pay-link" readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-[13px]" />
      </div>
      <CopyButton text={url} label={t.copy} doneText={t.copied} failedText={t.copyFailed} />
    </div>
  );
}
