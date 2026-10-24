"use client";

// The Safe's operations as dao_operations returns them for the viewer (ruling F4a-R5): outflows and noted inflows for
// members, never a donation and never an inflow's counterparty. An outflow without a note is "Sin explicar" (warning
// colour plus text and icon). Treasurers (MANAGE_TREASURY) annotate inline through set_operation_note.
import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { legacyExplorerTx, type LegacyChainId } from "@/lib/legacy/linea";
import { rpcErrorCode, rpcErrorMessage } from "@/lib/errors";
import { createBrowserClient } from "@/lib/supabase/browser";
import { formatToken } from "@/lib/treasury/format";
import type { Operation } from "@/lib/treasury/queries";

const MAX_NOTE = 280;

const dateTime = (iso: string) =>
  new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(iso)) + " UTC";

const linkClass =
  "inline-flex min-h-11 items-center rounded-control text-sm font-bold text-accent underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

export function OperationsList({ operations, chainId, canNote }: { operations: Operation[]; chainId: LegacyChainId; canNote: boolean }) {
  // Notes saved here show at once. Each remembers the server note it replaced: once the server's note for that operation
  // differs (the refresh brought ours, or another treasurer's newer one), the server wins and the local copy is ignored.
  const [saved, setSaved] = useState<Record<string, { note: string; replaced: string | null }>>({});
  if (operations.length === 0) return <p className="text-fg-muted">Aún no hay operaciones de la Safe registradas.</p>;
  return (
    <ul aria-label="Operaciones de la Safe" className="flex flex-col divide-y divide-border">
      {operations.map((op) => (
        <OperationRow
          key={op.id}
          op={saved[op.id] && saved[op.id]!.replaced === op.note ? { ...op, note: saved[op.id]!.note, explained: true } : op}
          chainId={chainId}
          canNote={canNote}
          onSaved={(note) => setSaved((s) => ({ ...s, [op.id]: { note, replaced: op.note } }))}
        />
      ))}
    </ul>
  );
}

function OperationRow({
  op,
  chainId,
  canNote,
  onSaved,
}: {
  op: Operation;
  chainId: LegacyChainId;
  canNote: boolean;
  onSaved: (note: string) => void;
}) {
  const out = op.direction === "out";
  const Arrow = out ? ArrowUpRight : ArrowDownLeft;
  const [editing, setEditing] = useState(false);
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1 text-[13px] font-bold text-fg-muted">
          <Arrow aria-hidden className="size-4 shrink-0" />
          {out ? "Salida" : "Entrada"}
        </span>
        <span className="font-mono text-sm font-bold break-all text-fg">{formatToken(op.amount, op.asset)}</span>
        <time dateTime={op.occurredAt} className="text-[13px] text-fg-muted">
          {dateTime(op.occurredAt)}
        </time>
        {op.txHash ? (
          <a
            href={legacyExplorerTx(chainId, op.txHash)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Ver en el explorador: ${out ? "salida" : "entrada"} de ${formatToken(op.amount, op.asset)}`}
            className={`${linkClass} ml-auto`}
          >
            Ver en el explorador
          </a>
        ) : null}
      </div>
      {op.note !== null ? (
        <p className="text-sm break-words text-fg">{op.note}</p>
      ) : !op.explained ? (
        <p className="inline-flex items-center gap-1.5 self-start rounded-control border border-warning px-2 py-0.5 text-[13px] font-bold text-warning">
          <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
          Sin explicar
        </p>
      ) : null}
      {canNote ? (
        editing ? (
          <NoteEditor
            opId={op.id}
            initial={op.note ?? ""}
            onCancel={() => setEditing(false)}
            onSaved={(note) => {
              setEditing(false);
              onSaved(note);
            }}
          />
        ) : (
          <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setEditing(true)}>
            {op.note !== null ? "Editar nota" : "Añadir nota"}
          </Button>
        )
      ) : null}
    </li>
  );
}

function NoteEditor({
  opId,
  initial,
  onCancel,
  onSaved,
}: {
  opId: string;
  initial: string;
  onCancel: () => void;
  onSaved: (note: string) => void;
}) {
  const router = useRouter();
  const id = useId();
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const note = text.trim();

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!note || pending) return;
    setPending(true);
    setError(null);
    try {
      const { error: rpcError } = await createBrowserClient().rpc("set_operation_note", { p_op: opId, p_note: note });
      if (rpcError) {
        setError(rpcErrorMessage(rpcErrorCode(rpcError)));
        return;
      }
      onSaved(note);
      router.refresh();
    } catch {
      setError("No se pudo guardar la nota. Inténtalo de nuevo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-2">
      <label htmlFor={id} className="sr-only">
        Nota de la operación
      </label>
      <textarea
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={MAX_NOTE}
        rows={2}
        disabled={pending}
        aria-describedby={`${id}-count`}
        placeholder="Qué fue esta operación (p. ej. swap de USDC a WETH)"
        className="min-h-20 w-full resize-y rounded-control border border-border-strong bg-surface px-3 py-2 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={!note || pending}>
          Guardar
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Cancelar
        </Button>
        <span id={`${id}-count`} className="ml-auto text-[13px] text-fg-muted">
          {text.length}/{MAX_NOTE}
        </span>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}
