"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Check, Copy, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { rpcErrorMessage } from "@/lib/errors";
import { createInviteAction } from "@/lib/invites/actions";
import { EXPIRY_OPTIONS, USES_OPTIONS } from "@/lib/invites/options";

const SELECT_CLASS =
  "min-h-11 w-full rounded-control border border-border-strong bg-surface px-3 text-sm text-fg outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50";

export function CreateInviteForm() {
  const usesId = useId();
  const expiryId = useId();
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    setCopied(false);
    setCopyError(false);
    startTransition(async () => {
      const res = await createInviteAction(fd);
      if (res.error || !res.url) {
        setUrl(null);
        setError(rpcErrorMessage(res.error ?? "unknown"));
        return;
      }
      setUrl(res.url);
    });
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopyError(false);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="flex flex-col gap-2">
          <Label htmlFor={usesId}>Usos</Label>
          <select id={usesId} name="max_uses" defaultValue="1" className={SELECT_CLASS}>
            {USES_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={expiryId}>Caduca en</Label>
          <select id={expiryId} name="expires_in" defaultValue="168" className={SELECT_CLASS}>
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={pending}>
          <Ticket aria-hidden />
          {pending ? "Creando…" : "Crear invitación"}
        </Button>
      </form>

      {error ? (
        <p role="alert" className="border border-danger px-4 py-3 text-[13px] text-danger rounded-control">
          {error}
        </p>
      ) : null}

      {url ? (
        <div className="flex flex-col gap-2 border border-border bg-surface p-4 rounded-panel">
          <Label htmlFor={`${usesId}-url`}>Tu enlace de invitación</Label>
          <p className="text-[13px] text-fg-muted">
            Cópialo ahora: por seguridad no volverá a mostrarse completo.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id={`${usesId}-url`}
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="font-mono text-[13px]"
            />
            <Button type="button" variant="secondary" onClick={copy}>
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              Copiar enlace
            </Button>
          </div>
          <p aria-live="polite" className="min-h-5 text-[13px] text-success">
            {copied ? "Copiado" : ""}
          </p>
          {copyError ? (
            <p role="alert" className="text-[13px] text-danger">
              No se pudo copiar. Selecciona el enlace y cópialo a mano.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
