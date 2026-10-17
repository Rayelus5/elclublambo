"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Trash2, X } from "lucide-react";
import { BanDialog } from "@/components/members/ban-dialog";
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
import { rpcErrorMessage } from "@/lib/errors";
import { deleteMessageAction } from "@/lib/chat/actions";
import { resolveReportAction } from "@/lib/reports/actions";
import type { ReportGroup } from "@/lib/reports/queries";
import { REPORT_REASON_LABEL } from "@/lib/reports/reasons";

const WHEN = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function When({ iso }: { iso: string }) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {WHEN.format(d)}
    </time>
  );
}

const OUTCOME: Record<string, string> = { dismissed: "Descartado", actioned: "Acción tomada" };

function ReportCard({ group, canBan }: { group: ReportGroup; canBan: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const open = group.status === "open";

  async function resolve(status: "dismissed" | "actioned"): Promise<boolean> {
    const res = await resolveReportAction(group.reportId, status).catch(() => ({ error: "unknown" }) as { error?: string });
    if (res.error) {
      setError(rpcErrorMessage(res.error));
      return false;
    }
    router.refresh();
    return true;
  }

  async function run(job: () => Promise<boolean>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      return await job();
    } finally {
      setBusy(false);
    }
  }

  const deleteAndResolve = async () => {
    const ok = await run(async () => {
      if (group.messageId && !group.messageDeleted) {
        const res = await deleteMessageAction(group.messageId).catch(() => ({ error: "unknown" }) as { error?: string });
        if (res.error) {
          setError(rpcErrorMessage(res.error));
          return false;
        }
      }
      return resolve("actioned");
    });
    if (ok) setConfirmDelete(false);
  };

  const author = group.author;
  const countLabel = group.count === 1 ? "1 reporte" : `${group.count} reportes`;

  return (
    <article className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-4" aria-busy={busy}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="font-display text-base font-bold text-fg">{countLabel}</h2>
        <Link
          href={`/c/${group.channel.id}`}
          className="inline-flex min-h-11 items-center rounded-control px-1 text-sm text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent"
        >
          #{group.channel.name}
        </Link>
        <span className="text-[13px] text-fg-muted">
          <When iso={group.latestAt} />
        </span>
        {!open ? (
          <span className="rounded-control border border-border-strong px-2 py-0.5 text-[13px] font-bold text-fg">
            {OUTCOME[group.status] ?? group.status}
          </span>
        ) : null}
      </header>

      <ul aria-label="Motivos" className="flex flex-wrap gap-2">
        {group.reasons.map((r) => (
          <li key={r.reason} className="rounded-control border border-border px-2 py-0.5 text-[13px] font-medium text-fg-muted">
            {REPORT_REASON_LABEL[r.reason]} ×{r.count}
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-1">
        <p className="text-[13px] text-fg-muted">
          Mensaje de <span className="font-bold text-fg">{author?.name ?? "un miembro"}</span>
          {group.messageDeleted ? " · el mensaje ya no está en el canal, esto es lo que se guardó" : ""}
        </p>
        <blockquote className="border-l-2 border-border-strong pl-3 text-sm break-words whitespace-pre-wrap text-fg">
          {group.snapshotText}
        </blockquote>
      </div>

      {group.notes.length > 0 ? (
        <ul aria-label="Notas de quienes reportaron" className="flex flex-col gap-1 text-sm text-fg-muted">
          {group.notes.map((n) => (
            <li key={n} className="break-words whitespace-pre-wrap">
              {n}
            </li>
          ))}
        </ul>
      ) : null}

      {error && !confirmDelete ? (
        <p role="alert" className="rounded-control border border-danger px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      {open ? (
        <div className="flex flex-wrap gap-2">
          {group.messageId && !group.messageDeleted ? (
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => setConfirmDelete(true)}>
              <Trash2 aria-hidden />
              Borrar mensaje
            </Button>
          ) : (
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void run(() => resolve("actioned"))}>
              <Check aria-hidden />
              Marcar como resuelto
            </Button>
          )}
          {canBan && author && author.status === "active" ? (
            <BanDialog
              member={{ id: author.id, walletAddress: author.walletAddress, displayName: author.name, status: author.status }}
              sponsor={author.sponsor}
              sponsorIsAdmin={author.sponsorIsAdmin}
              onBanned={() => void run(() => resolve("actioned"))}
            />
          ) : null}
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => resolve("dismissed"))}>
            <X aria-hidden />
            Descartar
          </Button>
        </div>
      ) : null}

      <AlertDialog
        open={confirmDelete}
        onOpenChange={(next) => {
          if (busy) return;
          setConfirmDelete(next);
          if (!next) setError(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar este mensaje?</AlertDialogTitle>
            <AlertDialogDescription>
              Se quitará del canal y los reportes de este mensaje se darán por resueltos. El texto guardado seguirá
              disponible para el equipo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(e) => {
                // Keep the dialog open until the server answers, so an error can be shown in it.
                e.preventDefault();
                void deleteAndResolve();
              }}
            >
              Borrar y resolver
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}

export function ReportQueue({
  groups,
  status,
  canBan,
}: {
  groups: ReportGroup[];
  status: "open" | "closed";
  canBan: boolean;
}) {
  if (groups.length === 0) {
    return (
      <p className="py-8 text-fg-muted">
        {status === "open"
          ? "No hay reportes abiertos. Cuando alguien reporte un mensaje de un canal que moderas, aparecerá aquí."
          : "Todavía no has resuelto ningún reporte."}
      </p>
    );
  }
  return (
    <ul aria-label={status === "open" ? "Reportes abiertos" : "Reportes resueltos"} className="flex flex-col gap-3">
      {groups.map((g) => (
        <li key={g.key}>
          <ReportCard group={g} canBan={canBan} />
        </li>
      ))}
    </ul>
  );
}
