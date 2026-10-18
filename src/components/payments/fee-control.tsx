"use client";

import { useId, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { bpsToPercentText, MAX_FEE_BPS, percentTextToBps } from "@/lib/economy/networks";

const STEP_BPS = 50;
/** "2,6 %" -> "2,6": the unit sits next to the field. */
const bare = (bps: number) => bpsToPercentText(bps).replace(/ %$/, "");

const stepBtn =
  "flex size-11 shrink-0 items-center justify-center rounded-control border border-border-strong text-fg outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-50";

/** The platform fee: the configured minimum is a locked floor; the member may raise it up to 50 %. */
export function FeeControl({
  minBps,
  value,
  onChange,
  disabled = false,
}: {
  minBps: number;
  value: number;
  onChange: (bps: number) => void;
  disabled?: boolean;
}) {
  const id = useId();
  // While the member types, the draft is what the field shows; on blur it falls back to the committed value.
  const [draft, setDraft] = useState<string | null>(null);
  const parsed = draft === null ? null : percentTextToBps(draft);
  const invalid = draft !== null && (parsed === null || parsed < minBps);

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-bold text-fg">
        Comisión (%)
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Bajar comisión 0,5 %"
          className={stepBtn}
          disabled={disabled || value <= minBps}
          onClick={() => {
            setDraft(null);
            onChange(Math.max(minBps, value - STEP_BPS));
          }}
        >
          <Minus aria-hidden className="size-4" />
        </button>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          disabled={disabled}
          aria-invalid={invalid || undefined}
          value={draft ?? bare(value)}
          onChange={(e) => {
            setDraft(e.target.value);
            const p = percentTextToBps(e.target.value);
            if (p !== null && p >= minBps) onChange(p);
          }}
          onBlur={() => setDraft(null)}
          className="min-h-11 w-24 min-w-0 rounded-control border border-border-strong bg-transparent px-3 text-center font-mono text-base text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg aria-invalid:border-danger"
        />
        <span aria-hidden className="text-fg-muted">
          %
        </span>
        <button
          type="button"
          aria-label="Subir comisión 0,5 %"
          className={stepBtn}
          disabled={disabled || value >= MAX_FEE_BPS}
          onClick={() => {
            setDraft(null);
            onChange(Math.min(MAX_FEE_BPS, value + STEP_BPS));
          }}
        >
          <Plus aria-hidden className="size-4" />
        </button>
      </div>
      {invalid ? (
        <p role="alert" className="text-[13px] text-danger">
          Escribe un porcentaje entre {bpsToPercentText(minBps)} y {bpsToPercentText(MAX_FEE_BPS)}.
        </p>
      ) : (
        <p className="text-[13px] text-fg-muted">
          {minBps > 0 ? `Mínimo ${bpsToPercentText(minBps)}: no se puede bajar de ahí.` : "Sin mínimo."} Puedes subirla si quieres apoyar más al club.
        </p>
      )}
    </div>
  );
}
