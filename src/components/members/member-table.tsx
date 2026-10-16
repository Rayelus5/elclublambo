"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shortAddress } from "@/lib/auth/wallet";
import { rpcErrorMessage } from "@/lib/errors";
import { toggleSponsorRoleAction } from "@/lib/moderation/actions";
import { BanDialog } from "./ban-dialog";
import { StatusBadge, type MemberSummary } from "./sponsor-tree";

export type AdminMemberRow = MemberSummary & {
  sponsor: MemberSummary | null;
  isPadrino: boolean;
  needsReview: boolean;
  createdAt: string;
};

const dateFmt = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeZone: "UTC" });

const nameOf = (m: MemberSummary) => m.displayName ?? shortAddress(m.walletAddress);

function PadrinoToggle({
  member,
  onError,
}: {
  member: AdminMemberRow;
  onError: (m: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      aria-pressed={member.isPadrino}
      disabled={pending}
      className={member.isPadrino ? "border-accent text-accent" : undefined}
      onClick={() => {
        onError(null);
        startTransition(async () => {
          const res = await toggleSponsorRoleAction({ memberId: member.id, enabled: !member.isPadrino });
          if (res.error) onError(rpcErrorMessage(res.error));
        });
      }}
    >
      <ShieldCheck aria-hidden />
      Padrino
    </Button>
  );
}

export function MemberTable({ members, meId }: { members: AdminMemberRow[]; meId: string | null }) {
  const [error, setError] = useState<string | null>(null);

  if (members.length === 0) return <p className="text-fg-muted">Todavía no hay miembros.</p>;

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="border border-danger px-4 py-3 text-[13px] text-danger rounded-control">
          {error}
        </p>
      ) : null}
      <div className="overflow-x-auto border border-border rounded-panel">
        <table className="w-full min-w-[48rem] border-collapse text-left text-sm">
          <caption className="sr-only">Miembros del club</caption>
          <thead className="bg-surface text-[13px] text-fg-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Miembro</th>
              <th scope="col" className="px-4 py-3 font-medium">Padrino de entrada</th>
              <th scope="col" className="px-4 py-3 font-medium">Alta</th>
              <th scope="col" className="px-4 py-3 font-medium">Estado</th>
              <th scope="col" className="px-4 py-3 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {members.map((m) => {
              const actionable = m.status === "active" && m.id !== meId;
              return (
                <tr key={m.id}>
                  <td className="px-4 py-2">
                    <Link
                      href={`/u/${m.walletAddress}`}
                      className="inline-flex min-h-11 items-center text-fg underline-offset-4 hover:underline"
                    >
                      <span className={m.displayName ? undefined : "font-mono"}>{nameOf(m)}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-fg-muted">
                    {m.sponsor ? (
                      <span className={m.sponsor.displayName ? undefined : "font-mono"}>{nameOf(m.sponsor)}</span>
                    ) : (
                      "Fundador"
                    )}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-fg-muted">
                    <time dateTime={m.createdAt}>{dateFmt.format(new Date(m.createdAt))}</time>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={m.status} />
                      {m.isPadrino ? (
                        <span className="inline-block border border-accent px-2 py-0.5 text-[13px] text-accent rounded-control">
                          Padrino
                        </span>
                      ) : null}
                      {m.needsReview ? (
                        <span className="inline-block border border-warning px-2 py-0.5 text-[13px] text-warning rounded-control">
                          Revisar
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    {actionable ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <PadrinoToggle member={m} onError={setError} />
                        <BanDialog member={m} sponsor={m.sponsor} />
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
