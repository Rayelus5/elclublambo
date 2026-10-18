import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { MemberAvatar } from "@/components/members/member-avatar";
import { hasFriendlyName, memberName, type MemberIdentity } from "@/lib/members/name";

export type MemberSummary = MemberIdentity & {
  id: string;
  status: "active" | "banned" | "left";
};

const STATUS_BADGE: Record<"banned" | "left", { label: string; className: string }> = {
  banned: { label: "Baneado", className: "border-danger text-danger" },
  left: { label: "Se fue", className: "border-border-strong text-fg-muted" },
};

export function StatusBadge({ status }: { status: MemberSummary["status"] }) {
  if (status === "active") return null;
  const { label, className } = STATUS_BADGE[status];
  return <span className={`inline-block border px-2 py-0.5 text-[13px] rounded-control ${className}`}>{label}</span>;
}

function MemberLink({ member }: { member: MemberSummary }) {
  return (
    <Link
      href={`/u/${member.walletAddress}`}
      className="flex min-h-11 items-center gap-3 px-4 py-2 hover:bg-surface-2"
    >
      <MemberAvatar member={member} size={32} />
      <span className={hasFriendlyName(member) ? "text-fg" : "font-mono text-fg"}>{memberName(member)}</span>
      <StatusBadge status={member.status} />
      <ChevronRight aria-hidden className="ml-auto size-4 text-fg-muted" />
    </Link>
  );
}

export function SponsorTree({ sponsor, invitees }: { sponsor: MemberSummary | null; invitees: MemberSummary[] }) {
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="le-invito" className="flex flex-col gap-3">
        <h2 id="le-invito" className="text-h3">
          Le invitó
        </h2>
        {sponsor ? (
          <div className="border border-border rounded-panel">
            <MemberLink member={sponsor} />
          </div>
        ) : (
          <p className="text-fg-muted">Miembro fundador</p>
        )}
      </section>

      <section aria-labelledby="ha-invitado" className="flex flex-col gap-3">
        <h2 id="ha-invitado" className="text-h3">
          Ha invitado ({invitees.length})
        </h2>
        {invitees.length === 0 ? (
          <p className="text-fg-muted">Aún no ha invitado a nadie</p>
        ) : (
          <ul className="divide-y divide-border border border-border rounded-panel">
            {invitees.map((m) => (
              <li key={m.id}>
                <MemberLink member={m} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
