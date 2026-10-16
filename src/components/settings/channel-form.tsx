"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteChannelAction, updateChannelAction } from "@/lib/channels/actions";
import { SLOWMODE_MAX, SLOWMODE_MIN, type ChannelDetailRow } from "@/lib/channels/tree";
import { rpcErrorMessage } from "@/lib/errors";

const SELECT_CLASS =
  "min-h-11 w-full rounded-control border border-border-strong bg-surface px-3 text-sm text-fg outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50";

const PRESETS: { value: number; label: string }[] = [
  { value: 0, label: "Desactivado" },
  { value: 5, label: "5 s" },
  { value: 10, label: "10 s" },
  { value: 30, label: "30 s" },
  { value: 60, label: "1 min" },
  { value: 300, label: "5 min" },
  { value: 900, label: "15 min" },
  { value: 3600, label: "1 h" },
  { value: 21600, label: "6 h" },
  { value: 86400, label: "1 día" },
  { value: 604800, label: "1 semana" },
];
const CUSTOM = "custom";
const RANGE_ERROR = `Escribe entre ${SLOWMODE_MIN} y ${SLOWMODE_MAX} segundos.`;

type Props = {
  channel: ChannelDetailRow;
  /** Se llama tras guardar o borrar con éxito. */
  onDone?: (result: "saved" | "deleted") => void;
};

export function ChannelForm({ channel, onDone }: Props) {
  const router = useRouter();
  const uid = useId();
  const isPreset = PRESETS.some((p) => p.value === channel.slowmodeSeconds);
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic ?? "");
  const [slowmode, setSlowmode] = useState<string>(isPreset ? String(channel.slowmodeSeconds) : CUSTOM);
  const [custom, setCustom] = useState<string>(isPreset ? "" : String(channel.slowmodeSeconds));
  const [tickets, setTickets] = useState(channel.ticketsEnabled);
  const [alpha, setAlpha] = useState(channel.alphaEnabled);
  const [customError, setCustomError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const isText = channel.kind === "text";

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    let seconds = Number(slowmode);
    if (slowmode === CUSTOM) {
      seconds = Number(custom);
      if (!/^\d+$/.test(custom.trim()) || seconds < SLOWMODE_MIN || seconds > SLOWMODE_MAX) {
        setCustomError(RANGE_ERROR);
        return;
      }
    }
    setCustomError(null);
    startTransition(async () => {
      const res = await updateChannelAction({
        id: channel.id,
        name,
        topic,
        slowmodeSeconds: seconds,
        ticketsEnabled: isText && tickets,
        alphaEnabled: isText && alpha,
      });
      if (res.error) {
        setError(rpcErrorMessage(res.error));
        return;
      }
      setSaved(true);
      router.refresh();
      onDone?.("saved");
    });
  }

  function confirmDelete() {
    setError(null);
    startTransition(async () => {
      const res = await deleteChannelAction(channel.id);
      if (res.error) {
        setError(rpcErrorMessage(res.error));
        setDeleteOpen(false);
        return;
      }
      setDeleteOpen(false);
      router.refresh();
      onDone?.("deleted");
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${uid}-name`}>Nombre</Label>
        <Input
          id={`${uid}-name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={50}
          required
          disabled={pending}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${uid}-topic`}>Descripción</Label>
        <textarea
          id={`${uid}-topic`}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          maxLength={300}
          rows={3}
          disabled={pending}
          className="min-h-20 w-full resize-y rounded-control border border-border-strong bg-surface px-3 py-2 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${uid}-slow`}>Slowmode</Label>
        <select
          id={`${uid}-slow`}
          value={slowmode}
          onChange={(e) => {
            setSlowmode(e.target.value);
            setCustomError(null);
          }}
          disabled={pending}
          className={SELECT_CLASS}
        >
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
          <option value={CUSTOM}>Personalizado (segundos)</option>
        </select>
        {slowmode === CUSTOM ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${uid}-custom`}>Segundos</Label>
            <Input
              id={`${uid}-custom`}
              type="number"
              inputMode="numeric"
              min={SLOWMODE_MIN}
              max={SLOWMODE_MAX}
              value={custom}
              onChange={(e) => {
                setCustom(e.target.value);
                setCustomError(null);
              }}
              aria-invalid={customError !== null}
              aria-describedby={customError ? `${uid}-custom-error` : undefined}
              disabled={pending}
            />
            {customError ? (
              <p id={`${uid}-custom-error`} role="alert" className="text-[13px] text-danger">
                {customError}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {isText ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="sr-only">Funciones del canal</legend>
          <div className="flex min-h-11 items-center gap-3">
            <Checkbox
              id={`${uid}-tickets`}
              checked={tickets}
              onCheckedChange={(v) => setTickets(v === true)}
              disabled={pending}
            />
            <Label htmlFor={`${uid}-tickets`} className="font-normal">
              Tickets
            </Label>
          </div>
          <div className="flex min-h-11 items-center gap-3">
            <Checkbox
              id={`${uid}-alpha`}
              checked={alpha}
              onCheckedChange={(v) => setAlpha(v === true)}
              disabled={pending}
            />
            <Label htmlFor={`${uid}-alpha`} className="font-normal">
              Alpha
            </Label>
          </div>
        </fieldset>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-control border border-danger px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
      <p aria-live="polite" className="min-h-5 text-[13px] text-success">
        {saved ? "Cambios guardados" : ""}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Guardar"}
        </Button>

        <AlertDialog open={deleteOpen} onOpenChange={(o) => !pending && setDeleteOpen(o)}>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="secondary" className="border-danger text-danger" disabled={pending}>
              <Trash2 aria-hidden />
              Borrar canal
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="data-[size=default]:max-w-md data-[size=default]:sm:max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle>Borrar {channel.name}</AlertDialogTitle>
              <AlertDialogDescription>
                Se borra el canal y sus permisos. Si tiene subcanales, primero tendrás que moverlos o borrarlos.
                No se puede deshacer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={pending}
                onClick={(e) => {
                  e.preventDefault();
                  confirmDelete();
                }}
              >
                {pending ? "Borrando…" : "Borrar"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </form>
  );
}
