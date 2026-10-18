import { Suspense } from "react";
import type { Metadata } from "next";
import { after } from "next/server";
import { HowItWorksLink } from "@/components/guide/how-it-works-link";
import { BalanceChart, ShareDonut } from "@/components/treasury/dao-charts";
import { DaoHistory } from "@/components/treasury/dao-history";
import { DaoLive } from "@/components/treasury/dao-live";
import { DaoOverview } from "@/components/treasury/dao-overview";
import { DaoRanking } from "@/components/treasury/dao-ranking";
import { DonateButton } from "@/components/treasury/donate-button";
import { RankingToggle } from "@/components/treasury/ranking-toggle";
import { createServerClient } from "@/lib/supabase/server";
import { balanceSeries, donutSlices } from "@/lib/treasury/charts";
import { finalitySnapshot } from "@/lib/treasury/finality";
import { getDaoHistory, getDaoOverview, getDaoRanking } from "@/lib/treasury/queries";
import { settlePendingDonations, shouldSettleFromView } from "@/lib/treasury/settle";

export const metadata: Metadata = { title: "DAO" };

type Search = Promise<{ donar?: string | string[] }>;

// Lee cookies (dinámico): con cacheComponents debe vivir dentro de un Suspense.
async function DaoContent({ searchParams }: { searchParams: Search }) {
  const { donar } = await searchParams;
  const supabase = await createServerClient();
  const { data: me } = await supabase.rpc("current_member_id");
  const memberId = typeof me === "string" ? me : null;

  const [overview, ranking, history, own] = await Promise.all([
    getDaoOverview(supabase),
    getDaoRanking(supabase, 50),
    getDaoHistory(supabase, 50),
    memberId ? supabase.from("members").select("dao_ranking_visible").eq("id", memberId).maybeSingle<{ dao_ranking_visible: boolean }>() : null,
  ]);
  // The estimate costs one RPC read: only when the viewer has something waiting for finality.
  const finality = overview.myPending.length > 0 ? await finalitySnapshot(overview.chainId) : undefined;
  // Viewing the DAO settles whatever is already final (anyone's, a few per view) without waiting for the cron or the
  // donor's next visit; a credit then reaches every open /dao through DaoLive.
  const chainId = overview.chainId;
  if (shouldSettleFromView()) {
    after(() => settlePendingDonations(chainId, { limit: 5 }).catch((e) => console.error("[treasury] dao page settle failed", e)));
  }

  return (
    <div className="flex w-full flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1">DAO</h1>
        <p className="text-fg-muted">La tesorería común del club en esta red. Aportar te da participaciones en su registro.</p>
        <HowItWorksLink section="dao" className="self-start" />
      </header>

      {/* Live: any donation recorded, credited or reverted (or a ranking opt-in) re-renders this page. */}
      <DaoLive />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <DaoOverview
          data={overview}
          donate={<DonateButton autoOpen={donar === "1"} />}
          finality={finality}
          chart={<BalanceChart points={balanceSeries(history, overview.valueUsdc)} />}
        />
        <section aria-labelledby="split-title" className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6">
          <h2 id="split-title" className="text-h2">
            Reparto
          </h2>
          <ShareDonut slices={donutSlices(ranking)} donors={overview.donors} />
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section aria-labelledby="ranking-title" className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6">
          <h2 id="ranking-title" className="text-h2">
            Ranking
          </h2>
          <DaoRanking entries={ranking} viewerId={memberId} />
          <RankingToggle initial={own?.data?.dao_ranking_visible === true} />
        </section>

        <section aria-labelledby="history-title" className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6">
          <h2 id="history-title" className="text-h2">
            Historial
          </h2>
          <DaoHistory entries={history} chainId={overview.chainId} />
        </section>
      </div>

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
