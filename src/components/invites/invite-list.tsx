"use client";

import { useState, useTransition } from "react";
import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { rpcErrorMessage } from "@/lib/errors";
import { revokeInviteAction } from "@/lib/invites/actions";
import type { InviteStatus } from "@/lib/invites/status";

export type InviteRow = {
  id: string;
  codePrefix: string;
  uses: number;
  maxUses: number;
  expiresAt: string;
  createdAt: string;
  status: InviteStatus;
};

const BADGE: Record<InviteStatus, string> = {
  activa: "border-success text-success",
  agotada: "border-warning text-warning",
  caducada: "border-border-strong text-fg-muted",
  anulada: "border-danger text-danger",
};

const LABEL: Record<InviteStatus, string> = {
  activa: "Activa",
  agotada: "Agotada",
  caducada: "Caducada",
  anulada: "Anulada",
};

const dateFmt = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

function formatDate(iso: string): string {
  return `${dateFmt.format(new Date(iso))} UTC`;
}

function RevokeButton({ id, onError }: { id: string; onError: (m: string | null) => void }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      disabled={pending}
      onClick={() => {
        onError(null);
        startTransition(async () => {
          const res = await revokeInviteAction(id);
          if (res.error) onError(rpcErrorMessage(res.error));
        });
      }}
    >
      <Ban aria-hidden />
      {pending ? "Anulando…" : "Anular"}
    </Button>
  );
}

export function InviteList({ invites }: { invites: InviteRow[] }) {
  const [error, setError] = useState<string | null>(null);

  if (invites.length === 0) {
    return <p className="text-fg-muted">Aún no has creado ninguna invitación.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="border border-danger px-4 py-3 text-[13px] text-danger rounded-control">
          {error}
        </p>
      ) : null}
      <div className="relative overflow-x-auto border border-border rounded-panel">
        <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
          <caption className="sr-only">Tus invitaciones</caption>
          <thead className="bg-surface text-[13px] text-fg-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Código</th>
              <th scope="col" className="px-4 py-3 font-medium">Estado</th>
              <th scope="col" className="px-4 py-3 font-medium">Usos</th>
              <th scope="col" className="px-4 py-3 font-medium">Caduca</th>
              <th scope="col" className="px-4 py-3 font-medium">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {invites.map((inv) => (
              <tr key={inv.id} className="border-t border-border">
                <td className="px-4 py-2 font-mono text-fg">{inv.codePrefix}…</td>
                <td className="px-4 py-2">
                  <span className={`inline-block border px-2 py-0.5 text-[13px] rounded-control ${BADGE[inv.status]}`}>
                    {LABEL[inv.status]}
                  </span>
                </td>
                <td className="px-4 py-2 font-mono text-fg">
                  {inv.uses}/{inv.maxUses}
                </td>
                <td className="px-4 py-2 text-fg-muted">{formatDate(inv.expiresAt)}</td>
                <td className="px-4 py-2 text-right">
                  {inv.status === "activa" ? <RevokeButton id={inv.id} onError={setError} /> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
