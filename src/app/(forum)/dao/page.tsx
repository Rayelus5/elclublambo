import { Suspense } from "react";
import type { Metadata } from "next";
import { HowItWorksLink } from "@/components/guide/how-it-works-link";
import { DaoHistory } from "@/components/treasury/dao-history";
import { DaoOverview } from "@/components/treasury/dao-overview";
import { DaoRanking } from "@/components/treasury/dao-ranking";
import { DonateButton } from "@/components/treasury/donate-button";
import { RankingToggle } from "@/components/treasury/ranking-toggle";
import { ReconcilePanel } from "@/components/treasury/reconcile-panel";
import { hasPerm, Perm } from "@/lib/permissions/bits";
import { createServerClient } from "@/lib/supabase/server";
import { getLastReconciliation } from "@/lib/treasury/last-run";
import { getDaoHistory, getDaoOverview, getDaoRanking } from "@/lib/treasury/queries";

export const metadata: Metadata = { title: "DAO" };

type Search = Promise<{ donar?: string | string[] }>;

// Lee cookies (dinámico): con cacheComponents debe vivir dentro de un Suspense.
async function DaoContent({ searchParams }: { searchParams: Search }) {
  const { donar } = await searchParams;
  const supabase = await createServerClient();
  const [{ data: rawPerms }, { data: me }] = await Promise.all([supabase.rpc("my_permissions"), supabase.rpc("current_member_id")]);
  const memberId = typeof me === "string" ? me : null;
  const perms = BigInt(String(rawPerms ?? 0));

  const [overview, ranking, history, own] = await Promise.all([
    getDaoOverview(supabase),
    getDaoRanking(supabase, 50),
    getDaoHistory(supabase, 50),
    memberId ? supabase.from("members").select("dao_ranking_visible").eq("id", memberId).maybeSingle<{ dao_ranking_visible: boolean }>() : null,
  ]);
  // The service-role read of the last run happens only once MANAGE_TREASURY is confirmed.
  const last = hasPerm(perms, Perm.MANAGE_TREASURY) ? await getLastReconciliation(overview.chainId) : null;

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1">DAO</h1>
        <p className="text-fg-muted">La tesorería común del club en esta red. Aportar te da participaciones en su registro.</p>
        <HowItWorksLink section="dao" className="self-start" />
      </header>

      <DaoOverview data={overview} donate={<DonateButton autoOpen={donar === "1"} />} />

      <section aria-labelledby="ranking-title" className="flex flex-col gap-4">
        <h2 id="ranking-title" className="text-h2">
          Ranking
        </h2>
        <DaoRanking entries={ranking} viewerId={memberId} />
        <RankingToggle initial={own?.data?.dao_ranking_visible === true} />
      </section>

      <section aria-labelledby="history-title" className="flex flex-col gap-4">
        <h2 id="history-title" className="text-h2">
          Historial
        </h2>
        <DaoHistory entries={history} chainId={overview.chainId} />
      </section>

      <ReconcilePanel perms={perms} last={last} />

      <p role="note" className="border-t border-border pt-4 text-[13px] text-fg-muted">
        La tesorería la custodian los firmantes de la Safe. Las participaciones son un registro interno de la comunidad, no un producto financiero.
      </p>
    </div>
  );
}

export default function DaoPage({ searchParams }: { searchParams: Search }) {
  return (
    <Suspense fallback={<div className="min-h-64" aria-hidden />}>
      <DaoContent searchParams={searchParams} />
    </Suspense>
  );
}
