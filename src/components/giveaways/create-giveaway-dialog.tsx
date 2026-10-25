"use client";

import { clubPath } from "@/lib/club/paths";
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Info, Loader2, Plus } from "lucide-react";
import { newPrizeRow, PrizeEditor, prizeInputs, type PrizeRow } from "@/components/giveaways/prize-editor";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ChainId } from "@/lib/economy/networks";
import { createGiveawayAction } from "@/lib/giveaways/actions";
import type { RoleOption } from "@/lib/giveaways/format";

const TITLE_MAX = 80;
const DESCRIPTION_MAX = 500;
const MIN_MS = 10 * 60_000;
const MAX_MS = 30 * 86_400_000;
const CLOSE_RANGE = "El cierre debe estar entre 10 minutos y 30 días desde ahora.";
const FIELD =
  "min-h-11 w-full rounded-control border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg md:text-sm";

/** A datetime-local value (the viewer's zone, to the minute). */
function localValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** «Crear sorteo»: only rendered for treasurers (create_giveaway re-checks MANAGE_TREASURY and every prize). */
export function CreateGiveawayTrigger({ chains, roles }: { chains: readonly ChainId[]; roles: readonly RoleOption[] }) {
  const [open, setOpen] = useState(false);
  if (chains.length === 0) return null;
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus aria-hidden className="size-4" />
        Crear sorteo
      </Button>
      {open ? <CreateGiveawayDialog onOpenChange={setOpen} chains={chains} roles={roles} /> : null}
    </>
  );
}

function CreateGiveawayDialog({
  onOpenChange,
  chains,
  roles,
}: {
  onOpenChange(open: boolean): void;
  chains: readonly ChainId[];
  roles: readonly RoleOption[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [closesAt, setClosesAt] = useState(() => localValue(Date.now() + 86_400_000));
  const [rows, setRows] = useState<PrizeRow[]>(() => [newPrizeRow(chains[0]!)]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (t.length < 1 || t.length > TITLE_MAX) return setError(`Escribe un título de 1 a ${TITLE_MAX} caracteres.`);
    if (description.trim().length > DESCRIPTION_MAX) return setError(`La descripción tiene como mucho ${DESCRIPTION_MAX} caracteres.`);
    const close = new Date(closesAt);
    const ahead = close.getTime() - Date.now();
    if (Number.isNaN(ahead) || ahead < MIN_MS || ahead > MAX_MS) return setError(CLOSE_RANGE);
    const prizes = prizeInputs(rows);
    if (!prizes.ok) return setError(prizes.error);
    setError(null);
    start(async () => {
      try {
        const r = await createGiveawayAction({ title: t, description: description.trim() || null, closesAt: close.toISOString(), prizes: prizes.prizes });
        if (!r.ok) return setError(r.error);
        onOpenChange(false);
        router.push(clubPath(`/sorteos/${r.id}`));
      } catch {
        setError("No se pudo crear el sorteo. Inténtalo de nuevo.");
      }
    });
  }

  return (
    <Dialog open onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-bold">Crear sorteo</DialogTitle>
          <DialogDescription>Antes de abrirlo publicamos la huella de la semilla; el azar lo pone drand al cerrar.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <p className="flex items-start gap-2 rounded-control border border-accent p-3 text-sm">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
            Gratis: nunca se paga por participar. Todos tienen la misma probabilidad.
          </p>
          <div className="flex flex-col gap-1">
            <label htmlFor="giveaway-title" className="text-sm font-bold text-fg">
              Título
            </label>
            <Input id="giveaway-title" autoComplete="off" maxLength={TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} disabled={pending} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="giveaway-description" className="text-sm font-bold text-fg">
              Descripción (opcional)
            </label>
            <textarea
              id="giveaway-description"
              rows={2}
              maxLength={DESCRIPTION_MAX}
              className={`${FIELD} resize-y py-2`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={pending}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="giveaway-close" className="text-sm font-bold text-fg">
              Cierre
            </label>
            <input
              id="giveaway-close"
              type="datetime-local"
              className={FIELD}
              value={closesAt}
              onChange={(e) => setClosesAt(e.target.value)}
              aria-describedby="giveaway-close-hint"
              disabled={pending}
            />
            <p id="giveaway-close-hint" className="text-[13px] text-fg-muted">
              En tu hora local. Entre 10 minutos y 30 días desde ahora.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-bold text-fg">Premios</h3>
            <p className="text-[13px] text-fg-muted">Se sortean en orden: el primero sale antes. Cada persona gana como mucho un premio.</p>
            <PrizeEditor rows={rows} onChange={setRows} chains={chains} roles={roles} disabled={pending} />
          </div>
          {error ? (
            <p role="alert" className="rounded-control border border-danger p-3 text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : null}
              {pending ? "Creando…" : "Crear sorteo"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
