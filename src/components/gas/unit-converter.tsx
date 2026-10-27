"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { convert, usdFromWei, type Unit } from "@/lib/gas/units";
import type { Lang } from "@/lib/i18n/config";
import { fill, localDecimal } from "@/lib/i18n/fill";

type Labels = { title: string; lead: string; wei: string; gwei: string; eth: string; usd: string; invalid: string; usdDisabled: string; price: string };

const UNITS: Unit[] = ["wei", "gwei", "eth", "usd"];
const EMPTY: Record<Unit, string> = { wei: "", gwei: "", eth: "", usd: "" };

/**
 * wei / gwei / ETH / USD, all four in sync, client-only with the price the server read (P6-R5). The field being typed in
 * keeps the user's text; an invalid entry leaves the others as they were and says why under the field. Without a price,
 * USD is disabled. The other fields show `lang`'s decimal separator (a comma in Spanish); every field reads both.
 */
export function UnitConverter({ lang, labels, ethUsdE8 }: { lang: Lang; labels: Labels; ethUsdE8: string | null }) {
  const price = ethUsdE8 === null ? null : BigInt(ethUsdE8);
  const [values, setValues] = useState(EMPTY);
  const [invalid, setInvalid] = useState<Unit | null>(null);
  const base = useId();

  function change(unit: Unit, text: string) {
    if (text.trim() === "") {
      setValues(EMPTY);
      setInvalid(null);
      return;
    }
    const next = convert(text, unit, price);
    if (next) {
      const shown = Object.fromEntries(UNITS.map((u) => [u, localDecimal(next[u], lang)])) as Record<Unit, string>;
      setValues({ ...shown, [unit]: text });
      setInvalid(null);
    } else {
      setValues((v) => ({ ...v, [unit]: text }));
      setInvalid(unit);
    }
  }

  return (
    <section aria-labelledby={`${base}-title`} className="flex min-w-0 flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 id={`${base}-title`} className="font-display text-xl font-bold text-fg">
          {labels.title}
        </h2>
        <p className="text-sm text-fg-muted">{labels.lead}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {UNITS.map((unit) => {
          const id = `${base}-${unit}`;
          const disabled = unit === "usd" && price === null;
          const hint = disabled ? labels.usdDisabled : invalid === unit ? labels.invalid : null;
          return (
            <div key={unit} className="flex min-w-0 flex-col gap-2">
              <label htmlFor={id} className="text-sm font-medium text-fg">
                {labels[unit]}
              </label>
              <Input
                id={id}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                disabled={disabled}
                value={values[unit]}
                onChange={(e) => change(unit, e.target.value)}
                aria-invalid={invalid === unit || undefined}
                aria-describedby={hint ? `${id}-hint` : undefined}
                className="font-mono tabular-nums"
              />
              {/* Always in the DOM: a live region that appears together with its text is often not announced. */}
              <p id={`${id}-hint`} aria-live="polite" className={`text-sm empty:hidden ${disabled ? "text-fg-muted" : "text-danger"}`}>
                {hint}
              </p>
            </div>
          );
        })}
      </div>
      {price !== null && <p className="text-sm text-fg-muted">{fill(labels.price, { usd: localDecimal(usdFromWei(10n ** 18n, price), lang) })}</p>}
    </section>
  );
}
