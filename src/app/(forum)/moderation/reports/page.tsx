import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReportQueue } from "@/components/reports/report-queue";
import { hasPerm, Perm } from "@/lib/permissions/bits";
import { listReportQueue } from "@/lib/reports/queries";
import { createServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "open", label: "Abiertos", href: "/moderation/reports" },
  { id: "closed", label: "Resueltos", href: "/moderation/reports?status=closed" },
] as const;

// Lee cookies (dinámico): con cacheComponents debe vivir dentro de un Suspense.
async function ReportsContent({ searchParams }: { searchParams: Promise<{ status?: string | string[] }> }) {
  const { status: raw } = await searchParams;
  const status = raw === "closed" ? "closed" : "open";

  const supabase = await createServerClient();
  // A real 404 unless the reader moderates messages somewhere (hidden and missing look the same).
  const [{ data: anywhere }, { data: rawPerms }] = await Promise.all([
    supabase.rpc("has_any_channel_perm", { p_bit: 8 }),
    supabase.rpc("my_permissions"),
  ]);
  if (anywhere !== true) notFound();
  const perms = BigInt(String(rawPerms ?? 0));

  const groups = await listReportQueue(status, supabase);
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1">Reportes</h1>
        <p className="text-fg-muted">
          Mensajes que los miembros han señalado en los canales que moderas. Los reportes del mismo mensaje van juntos.
        </p>
      </header>
      <nav aria-label="Estado de los reportes" className="flex gap-1">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            aria-current={status === t.id ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center rounded-control border px-4 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
              status === t.id ? "border-accent text-fg" : "border-border text-fg-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <ReportQueue groups={groups} status={status} canBan={hasPerm(perms, Perm.BAN_MEMBERS)} />
    </div>
  );
}

export default function ModerationReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<div className="min-h-64" aria-hidden />}>
      <ReportsContent searchParams={searchParams} />
    </Suspense>
  );
}
