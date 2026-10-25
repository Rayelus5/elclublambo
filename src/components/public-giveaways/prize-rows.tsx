"use client";

import { useId, useRef, type KeyboardEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { AssetLogo } from "@/components/economy/asset-logo";
import { NetworkPicker } from "@/components/economy/network-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ChainId } from "@/lib/economy/networks";
import { parseAmount } from "@/lib/payments/amounts";
import type { PublicPrizeInput } from "@/lib/public-giveaways/types";
import { cn } from "@/lib/utils";

export const MAX_PRIZES = 10;
export const LABEL_MAX = 120;

type Kind = "crypto" | "custom";
export type PrizeRow = { key: string; kind: Kind; chainId: ChainId; amount: string; label: string };

/** The dictionary strings the rows need (a slice of giveaways.create). */
export type PrizeText = {
  prize: string;
  removePrize: string;
  kind: string;
  kindCustom: string;
  network: string;
  amount: string;
  customLabel: string;
  customHint: string;
  addPrize: string;
  maxPrizes: string;
  errAmount: string;
  errLabel: string;
};

let seq = 0;
export function newPrizeRow(chainId: ChainId): PrizeRow {
  seq += 1;
  return { key: `prize-${seq}`, kind: "crypto", chainId, amount: "", label: "" };
}

/** Per-row error text (by row key), or null when the row is ready. */
export function prizeError(r: PrizeRow, t: Pick<PrizeText, "errAmount" | "errLabel">): string | null {
  if (r.kind === "crypto") {
    const units = parseAmount(r.amount, "USDC");
    return units === null || units <= 0n ? t.errAmount : null;
  }
  const label = r.label.trim();
  return label.length < 1 || label.length > LABEL_MAX ? t.errLabel : null;
}

export function prizeInputs(rows: readonly PrizeRow[]): PublicPrizeInput[] {
  return rows.map((r) => (r.kind === "crypto" ? { kind: "crypto", chainId: r.chainId, amount: r.amount.trim() } : { kind: "custom", label: r.label.trim() }));
}

const NEXT_KEYS: Record<string, 1 | -1> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

/** USDC · Other as one segmented radiogroup (arrow keys move and select). */
function KindPicker({ value, onChange, label, kinds }: { value: Kind; onChange(k: Kind): void; label: string; kinds: readonly { value: Kind; text: string }[] }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const step = NEXT_KEYS[e.key];
    if (!step) return;
    e.preventDefault();
    const next = (i + step + kinds.length) % kinds.length;
    onChange(kinds[next]!.value);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex self-start rounded-control border border-border-strong p-0.5">
      {kinds.map((k, i) => {
        const checked = k.value === value;
        return (
          <button
            key={k.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(k.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "min-h-11 min-w-20 cursor-pointer rounded-control px-3 text-sm font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none",
              checked ? "bg-accent text-accent-foreground" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            {k.text}
          </button>
        );
      })}
    </div>
  );
}

function Row({
  row,
  rank,
  onChange,
  onRemove,
  chains,
  t,
  error,
  disabled,
}: {
  row: PrizeRow;
  rank: number;
  onChange(next: PrizeRow): void;
  onRemove?: () => void;
  chains: readonly ChainId[];
  t: PrizeText;
  error: string | null;
  disabled?: boolean;
}) {
  const id = useId();
  const set = (patch: Partial<PrizeRow>) => onChange({ ...row, ...patch });
  const kinds: { value: Kind; text: string }[] = [
    { value: "crypto", text: "USDC" },
    { value: "custom", text: t.kindCustom },
  ];
  const errId = `${id}-err`;
  return (
    <fieldset className="relative flex min-w-0 flex-col gap-3 rounded-panel border border-border p-3" disabled={disabled}>
      <legend className="float-left flex min-h-11 items-center pr-12 text-sm font-bold text-fg">{`${t.prize} ${rank}`}</legend>
      {onRemove ? (
        <Button type="button" variant="ghost" size="icon" className="absolute top-1.5 right-1.5" onClick={onRemove} aria-label={`${t.removePrize} ${rank}`}>
          <Trash2 aria-hidden className="size-4" />
        </Button>
      ) : null}
      <KindPicker value={row.kind} onChange={(kind) => set({ kind })} label={`${t.kind} ${rank}`} kinds={kinds} />
      {row.kind === "crypto" ? (
        <>
          {chains.length > 1 ? <NetworkPicker value={row.chainId} onChange={(chainId) => set({ chainId })} chains={chains} label={t.network} /> : null}
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-amount`} className="text-sm font-bold text-fg">
              {t.amount}
            </label>
            <div className="flex items-center gap-3">
              <AssetLogo token="USDC" chainId={row.chainId} size={32} />
              <Input
                id={`${id}-amount`}
                inputMode="decimal"
                autoComplete="off"
                value={row.amount}
                onChange={(e) => set({ amount: e.target.value })}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errId : undefined}
              />
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-label`} className="text-sm font-bold text-fg">
            {t.customLabel}
          </label>
          <Input
            id={`${id}-label`}
            autoComplete="off"
            maxLength={LABEL_MAX}
            value={row.label}
            onChange={(e) => set({ label: e.target.value })}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-hint ${errId}` : `${id}-hint`}
          />
          <p id={`${id}-hint`} className="text-[13px] text-fg-muted">
            {t.customHint}
          </p>
        </div>
      )}
      {error ? (
        <p id={errId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/** Up to 10 prize rows, by rank: the first row is the first prize drawn. `errors` maps a row key to its message. */
export function PrizeRows({
  rows,
  onChange,
  chains,
  t,
  errors,
  disabled,
}: {
  rows: readonly PrizeRow[];
  onChange(rows: PrizeRow[]): void;
  chains: readonly ChainId[];
  t: PrizeText;
  errors: Readonly<Record<string, string>>;
  disabled?: boolean;
}) {
  const full = rows.length >= MAX_PRIZES;
  const add = () => {
    if (full || chains.length === 0) return;
    onChange([...rows, newPrizeRow(chains[0]!)]);
  };
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, i) => (
        <Row
          key={row.key}
          row={row}
          rank={i + 1}
          chains={chains}
          t={t}
          error={errors[row.key] ?? null}
          disabled={disabled}
          onChange={(next) => onChange(rows.map((r) => (r.key === row.key ? next : r)))}
          onRemove={rows.length > 1 ? () => onChange(rows.filter((r) => r.key !== row.key)) : undefined}
        />
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={add} disabled={full || disabled} aria-describedby={full ? "public-prize-full" : undefined}>
          <Plus aria-hidden className="size-4" />
          {t.addPrize}
        </Button>
        {full ? (
          <p id="public-prize-full" className="text-[13px] text-fg-muted">
            {t.maxPrizes}
          </p>
        ) : null}
      </div>
    </div>
  );
}
