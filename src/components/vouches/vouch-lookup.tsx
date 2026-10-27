"use client";

import { useId, useState, type FormEvent } from "react";
import { CircleAlert, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Dictionary } from "@/lib/i18n";
import { parseVouchLookup } from "@/lib/vouches/lookup";

export type VouchLookupError = "invalid" | "notFound";

/** GET form of the tool (`?address=`, so a lookup is a shareable URL). A malformed value is caught before the round trip. */
export function VouchLookup({
  t,
  action,
  defaultValue,
  error,
}: {
  t: Dictionary["vouches"]["lookup"];
  action: string;
  defaultValue: string;
  error: VouchLookupError | null;
}) {
  const id = useId();
  const [value, setValue] = useState(defaultValue);
  const [localError, setLocalError] = useState<VouchLookupError | null>(null);
  // The server's error belongs to the submitted text: editing it clears the message.
  const [edited, setEdited] = useState(false);
  const shown = localError ?? (edited ? null : error);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    if (parseVouchLookup(value).kind === "invalid") {
      e.preventDefault();
      setLocalError("invalid");
    }
  }

  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <form method="get" action={action} onSubmit={onSubmit} noValidate role="search" className="flex flex-col gap-2">
      <label htmlFor={`${id}-q`} className="text-sm font-bold text-fg">
        {t.label}
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
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
          placeholder={t.placeholder}
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
        <Button type="submit" variant="outline" className="self-start">
          <Search aria-hidden />
          {t.submit}
        </Button>
      </div>
      {shown ? (
        <p id={errorId} role="alert" className="flex items-start gap-2 text-sm text-danger">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t[shown]}
        </p>
      ) : null}
      <p id={hintId} className="text-sm text-fg-muted">
        {t.hint}
      </p>
    </form>
  );
}
