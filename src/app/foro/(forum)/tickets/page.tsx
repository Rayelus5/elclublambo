import { clubPath } from "@/lib/club/paths";
import { Suspense } from "react";
import { PageLoader } from "@/components/shell/page-loader";
import Link from "next/link";
import { TicketList } from "@/components/tickets/ticket-list";
import { listTickets } from "@/lib/tickets/queries";
import { createServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

type Search = Promise<{ tab?: string | string[]; status?: string | string[] }>;

const linkClass = (active: boolean) =>
  cn(
    "inline-flex min-h-11 items-center rounded-control border px-4 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
    active ? "border-accent text-fg" : "border-border text-fg-muted hover:bg-surface-2 hover:text-fg",
  );

// Lee cookies (dinámico): con cacheComponents debe vivir dentro de un Suspense.
async function TicketsContent({ searchParams }: { searchParams: Search }) {
  const { tab: rawTab, status: rawStatus } = await searchParams;
  const status = rawStatus === "closed" ? "closed" : "open";

  const supabase = await createServerClient();
  const [me, staffAnywhere] = await Promise.all([
    supabase.rpc("current_member_id"),
    // MANAGE_TICKETS (16384) in at least one visible channel: the support inbox exists for them.
    supabase.rpc("has_any_channel_perm", { p_bit: 16384 }),
  ]);
  const memberId = typeof me.data === "string" ? me.data : "";
  const isStaff = staffAnywhere.data === true;
  const scope = rawTab === "staff" && isStaff ? "staff" : "mine";

  const items = memberId ? await listTickets({ scope, status }, supabase, memberId) : [];
  const href = (t: string, s: string) => {
    const q = new URLSearchParams();
    if (t === "staff") q.set("tab", "staff");
    if (s === "closed") q.set("status", "closed");
    const str = q.toString();
    return str ? clubPath(`/tickets?${str}`) : clubPath("/tickets");
  };

  return (
    <div className="flex w-full flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1">Tickets</h1>
        <p className="text-fg-muted">
          Conversaciones privadas con el equipo de soporte. Para abrir uno, entra en un canal que lo admita y pulsa «Abrir ticket».
        </p>
      </header>

      {isStaff ? (
        <nav aria-label="Bandeja" className="flex flex-wrap gap-1">
          <Link href={href("mine", status)} aria-current={scope === "mine" ? "page" : undefined} className={linkClass(scope === "mine")}>
            Mis tickets
          </Link>
          <Link href={href("staff", status)} aria-current={scope === "staff" ? "page" : undefined} className={linkClass(scope === "staff")}>
            Bandeja de soporte
          </Link>
        </nav>
      ) : null}

      <nav aria-label="Estado de los tickets" className="flex gap-1">
        <Link href={href(scope, "open")} aria-current={status === "open" ? "page" : undefined} className={linkClass(status === "open")}>
          Abiertos
        </Link>
        <Link href={href(scope, "closed")} aria-current={status === "closed" ? "page" : undefined} className={linkClass(status === "closed")}>
          Cerrados
        </Link>
      </nav>

      <TicketList
        items={items}
        showAuthor={scope === "staff"}
        empty={
          scope === "staff"
            ? status === "open"
              ? "No hay tickets abiertos esperando al equipo."
              : "Todavía no hay tickets cerrados."
            : status === "open"
              ? "No tienes tickets abiertos."
              : "No tienes tickets cerrados."
        }
      />
    </div>
  );
}

export default function TicketsPage({ searchParams }: { searchParams: Search }) {
  return (
    <Suspense fallback={<PageLoader />}>
      <TicketsContent searchParams={searchParams} />
    </Suspense>
  );
}
