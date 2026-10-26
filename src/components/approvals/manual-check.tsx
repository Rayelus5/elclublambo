"use client";

import { useId, useState, type FormEvent } from "react";
import { ChevronDown, CircleAlert, Info, Loader2, Search } from "lucide-react";
import { isAddress } from "viem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { checkAllowanceAction } from "@/lib/approvals/actions";
import type { ApprovalRow } from "@/lib/approvals/types";
import type { NetworkKey } from "@/lib/economy/networks";
import type { Dictionary } from "@/lib/i18n";

type Labels = Dictionary["approvals"]["manual"];
type Outcome = { kind: "none" } | { kind: "error"; error: keyof Labels["errors"] };

const isAddr = (v: string) => isAddress(v, { strict: false });

/**
 * The manual check (Review Focus 1): one (token, spender) pair of `owner`, read on the server. A live allowance is
 * handed to `onFound` (the list shows it with its «Retirar»); zero says so. Folded at the end of the list, open when the
 * list could not be obtained.
 */
export function ManualCheck({
  t,
  network,
  owner,
  open,
  onFound,
}: {
  t: Labels;
  network: NetworkKey;
  owner: `0x${string}`;
  open: boolean;
  onFound(row: ApprovalRow): void;
}) {
  const id = useId();
  const [token, setToken] = useState("");
  const [spender, setSpender] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const tk = token.trim();
    const sp = spender.trim();
    if (!isAddr(tk) || !isAddr(sp)) {
      setOutcome({ kind: "error", error: "invalid_input" });
      return;
    }
    setBusy(true);
    setOutcome(null);
    try {
      const res = await checkAllowanceAction({ chain: network, owner, token: tk, spender: sp });
      if (!res.ok) setOutcome({ kind: "error", error: res.error });
      else if (res.row) onFound(res.row);
      else setOutcome({ kind: "none" });
    } catch {
      setOutcome({ kind: "error", error: "rpc_unavailable" });
    } finally {
      setBusy(false);
    }
  }

  const outcomeId = `${id}-outcome`;
  const form = (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <p className="text-sm text-fg-muted">{t.lead}</p>
      {(["token", "spender"] as const).map((field) => (
        <div key={field} className="flex flex-col gap-2">
          <label htmlFor={`${id}-${field}`} className="text-sm font-bold text-fg">
            {t[field]}
          </label>
          <Input
            id={`${id}-${field}`}
            value={field === "token" ? token : spender}
            onChange={(e) => {
              (field === "token" ? setToken : setSpender)(e.target.value);
              setOutcome(null);
            }}
            placeholder="0x…"
            maxLength={64}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={outcome?.kind === "error" && outcome.error === "invalid_input" ? true : undefined}
            aria-describedby={outcome ? outcomeId : undefined}
            className="font-mono"
          />
        </div>
      ))}
      <Button type="submit" variant="outline" className="self-start" disabled={busy}>
        {busy ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Search aria-hidden />}
        {busy ? t.checking : t.submit}
      </Button>
      <div id={outcomeId} aria-live="polite">
        {outcome?.kind === "error" ? (
          <p role="alert" className="flex items-start gap-2 text-sm text-danger">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t.errors[outcome.error]}
          </p>
        ) : outcome?.kind === "none" ? (
          <p className="flex items-start gap-2 text-sm text-fg">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
            {t.none}
          </p>
        ) : null}
      </div>
    </form>
  );

  if (open) {
    return (
      <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3 rounded-panel border border-border p-4">
        <h3 id={`${id}-title`} className="text-base font-bold text-fg">
          {t.title}
        </h3>
        {form}
      </section>
    );
  }
  return (
    <details className="group rounded-panel border border-border">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-panel px-3 text-sm font-bold text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
        {t.title}
        <ChevronDown aria-hidden className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="px-3 pb-3">{form}</div>
    </details>
  );
}
