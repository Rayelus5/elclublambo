"use client";

import { useId, useState, type FormEvent } from "react";
import { CircleAlert, Search } from "lucide-react";
import { NetworkPicker } from "@/components/economy/network-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ADDRESS_RE, looksLikeAddress, MAX_QUERY_LENGTH } from "@/lib/checker/input";
import type { ChainId } from "@/lib/economy/networks";
import type { Dictionary } from "@/lib/i18n";

type Labels = Dictionary["checker"]["form"];
export type CheckerFormError = keyof Labels["errors"];

/**
 * The checker's GET form (`?q=…&chain=…`, so a report is a shareable URL). The network picker only shows for an address.
 * A malformed address is caught here too, before the round trip; the server validates again.
 */
export function CheckerForm({
  t,
  action,
  chains,
  defaultQuery,
  defaultChain,
  error,
}: {
  t: Labels;
  action: string;
  chains: readonly ChainId[];
  defaultQuery: string;
  defaultChain: ChainId;
  error: CheckerFormError | null;
}) {
  const id = useId();
  const [query, setQuery] = useState(defaultQuery);
  const [chain, setChain] = useState<ChainId>(defaultChain);
  const [localError, setLocalError] = useState<CheckerFormError | null>(null);
  // The server's error belongs to the submitted text: editing it clears the message.
  const [edited, setEdited] = useState(false);
  const shownError = localError ?? (edited ? null : error);
  const isAddress = looksLikeAddress(query);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    const text = query.trim();
    if (looksLikeAddress(text) && !ADDRESS_RE.test(text)) {
      e.preventDefault();
      setLocalError("invalid_address");
      return;
    }
    setLocalError(null);
  }

  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <form method="get" action={action} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-q`} className="text-sm font-bold text-fg">
          {t.label}
        </label>
        <Input
          id={`${id}-q`}
          name="q"
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setEdited(true);
            setLocalError(null);
          }}
          placeholder={t.placeholder}
          maxLength={MAX_QUERY_LENGTH}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          required
          aria-invalid={shownError ? true : undefined}
          aria-describedby={shownError ? `${errorId} ${hintId}` : hintId}
          className="font-mono"
        />
        {shownError ? (
          <p id={errorId} role="alert" className="flex items-start gap-2 text-sm text-danger">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t.errors[shownError]}
          </p>
        ) : null}
        <p id={hintId} className="text-sm text-fg-muted">
          {t.hint}
        </p>
      </div>
      {isAddress ? (
        <>
          <NetworkPicker value={chain} onChange={setChain} chains={chains} label={t.network} />
          <input type="hidden" name="chain" value={chain} />
        </>
      ) : null}
      <Button type="submit" className="self-start">
        <Search aria-hidden />
        {t.submit}
      </Button>
    </form>
  );
}
