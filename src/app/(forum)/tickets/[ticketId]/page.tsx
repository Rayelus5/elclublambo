import { Suspense } from "react";
import { notFound } from "next/navigation";
import { TicketView } from "@/components/tickets/ticket-view";
import { hasPerm, Perm } from "@/lib/permissions/bits";
import { createServerClient } from "@/lib/supabase/server";
import { UUID_RE } from "@/lib/tickets/model";
import { getTicket } from "@/lib/tickets/queries";

// Lee cookies (dinámico): con cacheComponents debe vivir dentro de un Suspense.
// The proxy answers the real 404 for a missing/inaccessible ticket; notFound() here is the fallback.
async function TicketContent({ params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;
  if (!UUID_RE.test(ticketId)) notFound();

  const supabase = await createServerClient();
  const detail = await getTicket(ticketId.toLowerCase(), supabase);
  if (!detail) notFound();

  const [perms, domains] = await Promise.all([
    supabase.rpc("my_channel_permissions", { p_channel: detail.ticket.channelId }),
    supabase.from("allowed_domains").select("domain"),
  ]);

  return (
    <TicketView
      key={detail.ticket.id}
      ticket={{
        id: detail.ticket.id,
        subject: detail.ticket.subject,
        status: detail.ticket.status,
        channelName: detail.ticket.channelName,
        authorId: detail.ticket.authorId,
      }}
      initialMessages={detail.messages}
      viewer={{ isStaff: hasPerm(BigInt(String(perms.data ?? 0)), Perm.MANAGE_TICKETS) }}
      allowedDomains={((domains.data ?? []) as Array<{ domain: string }>).map((d) => d.domain)}
    />
  );
}

export default function TicketPage({ params }: { params: Promise<{ ticketId: string }> }) {
  return (
    <Suspense fallback={<div className="min-h-64" aria-hidden />}>
      <TicketContent params={params} />
    </Suspense>
  );
}
