"use client";

import { clubPath } from "@/lib/club/paths";
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { BadgeCheck, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hasFriendlyName, memberName } from "@/lib/members/name";
import { rpcErrorMessage } from "@/lib/errors";
import { hasPerm, Perm } from "@/lib/permissions/bits";
import { setVerifiedAction, toggleSponsorRoleAction } from "@/lib/moderation/actions";
import { BanDialog } from "./ban-dialog";
import { StatusBadge, type MemberSummary } from "./sponsor-tree";

export type AdminMemberRow = MemberSummary & {
  sponsor: MemberSummary | null;
  sponsorIsAdmin?: boolean;
  isPadrino: boolean;
  isVerified: boolean;
  needsReview: boolean;
  createdAt: string;
};

const dateFmt = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeZone: "UTC" });

const nameOf = memberName;

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
      aria-label={`Padrino: ${nameOf(member)}`}
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

function VerifiedToggle({
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
      aria-label={`Verificado: ${nameOf(member)}`}
      aria-pressed={member.isVerified}
      disabled={pending}
      className={member.isVerified ? "border-success text-success" : undefined}
      onClick={() => {
        onError(null);
        startTransition(async () => {
          const res = await setVerifiedAction({ memberId: member.id, enabled: !member.isVerified });
          if (res.error) onError(rpcErrorMessage(res.error));
        });
      }}
    >
      <BadgeCheck aria-hidden />
      Verificado
    </Button>
  );
}

export function MemberTable({
  members,
  meId,
  perms,
}: {
  members: AdminMemberRow[];
  meId: string | null;
  perms: bigint;
}) {
  const [error, setError] = useState<string | null>(null);
  const [banned, setBanned] = useState<string | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const canManageRoles = hasPerm(perms, Perm.MANAGE_ROLES);
  const canVerify = hasPerm(perms, Perm.VERIFY_MEMBERS);
  const canBan = hasPerm(perms, Perm.BAN_MEMBERS);

  // The banned row loses its actions (and its dialog unmounts), so move focus to the announcement.
  function onBanned(m: MemberSummary) {
    setBanned(`Miembro baneado: ${nameOf(m)}`);
    requestAnimationFrame(() => statusRef.current?.focus());
  }

  if (members.length === 0) return <p className="text-fg-muted">Todavía no hay miembros.</p>;

  return (
    <div className="flex flex-col gap-3">
      <p ref={statusRef} role="status" tabIndex={-1} className="text-[13px] text-fg-muted outline-none empty:hidden">
        {banned}
      </p>
      {error ? (
        <p role="alert" className="border border-danger px-4 py-3 text-[13px] text-danger rounded-control">
          {error}
        </p>
      ) : null}
      <div className="relative overflow-x-auto border border-border rounded-panel">
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
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={clubPath(`/u/${m.walletAddress}`)}
                        className="inline-flex min-h-11 items-center text-fg underline-offset-4 hover:underline"
                      >
                        <span className={hasFriendlyName(m) ? undefined : "font-mono"}>{nameOf(m)}</span>
                      </Link>
                      {m.isPadrino ? (
                        <span className="inline-block border border-accent px-2 py-0.5 text-[13px] text-accent rounded-control">
                          Padrino
                        </span>
                      ) : null}
                      {m.isVerified ? (
                        <span className="inline-block border border-success px-2 py-0.5 text-[13px] text-success rounded-control">
                          Verificado
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-fg-muted">
                    {m.sponsor ? (
                      <span className={hasFriendlyName(m.sponsor) ? undefined : "font-mono"}>{nameOf(m.sponsor)}</span>
                    ) : (
                      "Fundador"
                    )}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-fg-muted">
                    <time dateTime={m.createdAt}>{dateFmt.format(new Date(m.createdAt))}</time>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {m.status === "active" ? (
                        <span className="inline-block border border-success px-2 py-0.5 text-[13px] text-success rounded-control">
                          Activo
                        </span>
                      ) : (
                        <StatusBadge status={m.status} />
                      )}
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
                        {canVerify ? <VerifiedToggle member={m} onError={setError} /> : null}
                        {canManageRoles ? <PadrinoToggle member={m} onError={setError} /> : null}
                        {canBan ? (
                          <BanDialog member={m} sponsor={m.sponsor} sponsorIsAdmin={m.sponsorIsAdmin} onBanned={onBanned} />
                        ) : null}
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
