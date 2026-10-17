"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addDomainAction, removeDomainAction } from "@/lib/domains/actions";
import { normalizeDomain } from "@/lib/domains/validate";
import { rpcErrorMessage } from "@/lib/errors";

const FORMAT_ERROR = "Escribe solo el dominio, sin https:// ni rutas. Ejemplo: github.com";

export function DomainList({ domains }: { domains: string[] }) {
  const router = useRouter();
  const uid = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const d = normalizeDomain(value);
    if (!d) {
      setError(FORMAT_ERROR);
      return;
    }
    startTransition(async () => {
      const res = await addDomainAction(d);
      if (res.error) {
        setError(rpcErrorMessage(res.error));
        return;
      }
      setValue("");
      router.refresh();
    });
  }

  function confirmRemove() {
    const d = removing;
    if (!d) return;
    setError(null);
    startTransition(async () => {
      const res = await removeDomainAction(d);
      setRemoving(null);
      if (res.error) {
        setError(rpcErrorMessage(res.error));
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={add} className="flex flex-col gap-2" noValidate>
        <Label htmlFor={`${uid}-d`}>Dominio</Label>
        <div className="flex gap-2">
          <Input
            id={`${uid}-d`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="ejemplo.com"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={error === FORMAT_ERROR}
            disabled={pending}
          />
          <Button type="submit" disabled={pending}>
            <Plus aria-hidden />
            Añadir
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        ) : null}
      </form>

      {domains.length === 0 ? (
        <p className="rounded-panel border border-dashed border-border-strong p-6 text-fg-muted">
          No hay dominios permitidos todavía.
        </p>
      ) : (
        <ul className="flex flex-col rounded-panel border border-border bg-surface">
          {domains.map((d) => (
            <li key={d} className="flex items-center justify-between gap-3 border-b border-border py-1 pl-4 pr-1 last:border-b-0">
              <span className="min-w-0 truncate font-mono text-sm text-fg">{d}</span>
              <button
                type="button"
                aria-label={`Quitar ${d}`}
                disabled={pending}
                onClick={() => setRemoving(d)}
                className="flex size-11 shrink-0 items-center justify-center rounded-control text-fg-muted transition-colors duration-150 outline-none hover:bg-surface-2 hover:text-danger focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50 motion-reduce:transition-none"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={removing !== null} onOpenChange={(o) => !o && !pending && setRemoving(null)}>
        <AlertDialogContent className="data-[size=default]:max-w-md data-[size=default]:sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Quitar {removing}</AlertDialogTitle>
            <AlertDialogDescription>
              Los enlaces a este dominio dejarán de poder publicarse. Los que ya existen no se borran.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                confirmRemove();
              }}
            >
              {pending ? "Quitando…" : "Quitar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
