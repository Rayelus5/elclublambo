"use client";

import { useId, useRef, type KeyboardEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { NetworkPicker } from "@/components/economy/network-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ChainId } from "@/lib/economy/networks";
import type { GiveawayPrizeInput } from "@/lib/giveaways/actions";
import type { RoleOption } from "@/lib/giveaways/format";
import { parseAmount } from "@/lib/payments/amounts";
import { cn } from "@/lib/utils";

export const MAX_PRIZES = 10;
const LABEL_MAX = 120;

type Kind = "crypto" | "role" | "custom";
const KINDS: { value: Kind; text: string }[] = [
  { value: "crypto", text: "USDC" },
  { value: "role", text: "Rol" },
  { value: "custom", text: "Otro" },
];

export type PrizeRow = { key: string; kind: Kind; chainId: ChainId; amount: string; roleId: string; label: string };

let seq = 0;
export function newPrizeRow(chainId: ChainId): PrizeRow {
  seq += 1;
  return { key: `prize-${seq}`, kind: "crypto", chainId, amount: "", roleId: "", label: "" };
}

/** The rows as createGiveawayAction takes them, or the first row that is not ready (by rank). */
export function prizeInputs(rows: readonly PrizeRow[]): { ok: true; prizes: GiveawayPrizeInput[] } | { ok: false; error: string } {
  const prizes: GiveawayPrizeInput[] = [];
  for (const [i, r] of rows.entries()) {
    const at = `Premio ${i + 1}: `;
    if (r.kind === "crypto") {
      const units = parseAmount(r.amount, "USDC");
      if (units === null || units <= 0n) return { ok: false, error: `${at}escribe un importe mayor que 0.` };
      prizes.push({ kind: "crypto", chainId: r.chainId, amount: r.amount.trim() });
    } else if (r.kind === "role") {
      if (!r.roleId) return { ok: false, error: `${at}elige un rol.` };
      prizes.push({ kind: "role", roleId: r.roleId });
    } else {
      const label = r.label.trim();
      if (label.length < 1 || label.length > LABEL_MAX) return { ok: false, error: `${at}describe el premio (1 a ${LABEL_MAX} caracteres).` };
      prizes.push({ kind: "custom", label });
    }
  }
  return { ok: true, prizes };
}

const NEXT_KEYS: Record<string, 1 | -1> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

/** USDC · Rol · Otro as one segmented radiogroup (arrow keys move and select). */
function KindPicker({ value, onChange, label, disabled }: { value: Kind; onChange(k: Kind): void; label: string; disabled?: boolean }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const step = NEXT_KEYS[e.key];
    if (!step) return;
    e.preventDefault();
    const next = (i + step + KINDS.length) % KINDS.length;
    onChange(KINDS[next]!.value);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex self-start rounded-control border border-border-strong p-0.5">
      {KINDS.map((k, i) => {
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
            disabled={disabled}
            onClick={() => onChange(k.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "min-h-11 min-w-16 cursor-pointer rounded-control px-3 text-sm font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50",
              checked ? "bg-accent text-bg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            {k.text}
          </button>
        );
      })}
    </div>
  );
}

const SELECT =
  "min-h-11 w-full rounded-control border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg md:text-sm";

function Row({
  row,
  rank,
  onChange,
  onRemove,
  chains,
  roles,
  disabled,
}: {
  row: PrizeRow;
  rank: number;
  onChange(next: PrizeRow): void;
  onRemove?: () => void;
  chains: readonly ChainId[];
  roles: readonly RoleOption[];
  disabled?: boolean;
}) {
  const id = useId();
  const set = (patch: Partial<PrizeRow>) => onChange({ ...row, ...patch });
  return (
    <fieldset className="relative flex min-w-0 flex-col gap-3 rounded-panel border border-border p-3" disabled={disabled}>
      <legend className="float-left flex min-h-11 items-center pr-12 text-sm font-bold text-fg">{`Premio ${rank}`}</legend>
      {onRemove ? (
        <Button type="button" variant="ghost" size="icon" className="absolute top-1.5 right-1.5" onClick={onRemove} aria-label={`Quitar premio ${rank}`}>
          <Trash2 aria-hidden className="size-4" />
        </Button>
      ) : null}
      <KindPicker value={row.kind} onChange={(kind) => set({ kind })} label={`Tipo del premio ${rank}`} disabled={disabled} />
      {row.kind === "crypto" ? (
        <>
          {chains.length > 1 ? <NetworkPicker value={row.chainId} onChange={(chainId) => set({ chainId })} chains={chains} label="Red" /> : null}
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-amount`} className="text-sm font-bold text-fg">
              Importe en USDC
            </label>
            <Input id={`${id}-amount`} inputMode="decimal" autoComplete="off" value={row.amount} onChange={(e) => set({ amount: e.target.value })} />
          </div>
        </>
      ) : row.kind === "role" ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-role`} className="text-sm font-bold text-fg">
            Rol
          </label>
          {roles.length === 0 ? (
            <p className="text-[13px] text-fg-muted">No hay roles que puedas sortear: deben estar por debajo del tuyo y sin permisos de gestión.</p>
          ) : null}
          <select id={`${id}-role`} className={SELECT} value={row.roleId} onChange={(e) => set({ roleId: e.target.value })}>
            <option value="">Elige un rol</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <p className="text-[13px] text-fg-muted">Se asigna al ganador en el momento del sorteo.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-label`} className="text-sm font-bold text-fg">
            Premio
          </label>
          <Input id={`${id}-label`} autoComplete="off" maxLength={LABEL_MAX} value={row.label} onChange={(e) => set({ label: e.target.value })} />
          <p className="text-[13px] text-fg-muted">Lo entrega un tesorero a mano, por ejemplo «Camiseta».</p>
        </div>
      )}
    </fieldset>
  );
}

/** Up to 10 prize rows, by rank: the first row is the first prize drawn. */
export function PrizeEditor({
  rows,
  onChange,
  chains,
  roles,
  disabled,
}: {
  rows: readonly PrizeRow[];
  onChange(rows: PrizeRow[]): void;
  chains: readonly ChainId[];
  roles: readonly RoleOption[];
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
          roles={roles}
          disabled={disabled}
          onChange={(next) => onChange(rows.map((r) => (r.key === row.key ? next : r)))}
          onRemove={rows.length > 1 ? () => onChange(rows.filter((r) => r.key !== row.key)) : undefined}
        />
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={add} disabled={full || disabled} aria-describedby={full ? "prize-editor-full" : undefined}>
          <Plus aria-hidden className="size-4" />
          Añadir premio
        </Button>
        {full ? (
          <p id="prize-editor-full" className="text-[13px] text-fg-muted">
            Máximo 10 premios.
          </p>
        ) : null}
      </div>
    </div>
  );
}
