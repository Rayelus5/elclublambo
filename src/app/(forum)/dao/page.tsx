import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { safeError } from "@/lib/security/redact";
import { HowItWorksLink } from "@/components/guide/how-it-works-link";
import { ShareDonut } from "@/components/treasury/dao-charts";
import { DaoHistory } from "@/components/treasury/dao-history";
import { DaoLive } from "@/components/treasury/dao-live";
import { DaoOverview } from "@/components/treasury/dao-overview";
import { DaoRanking } from "@/components/treasury/dao-ranking";
import { DonateButton } from "@/components/treasury/donate-button";
import { FundComposition } from "@/components/treasury/fund-composition";
import { NavChart } from "@/components/treasury/nav-chart";
import { OperationsList } from "@/components/treasury/operations-list";
import { WithdrawControls } from "@/components/treasury/withdraw-controls";
import { RaffleList } from "@/components/treasury/raffles/raffle-list";
import { RankingToggle } from "@/components/treasury/ranking-toggle";
import { getEconomyConfig } from "@/lib/economy/config";
import { explorerAddress } from "@/lib/economy/networks";
import { hasPerm, Perm } from "@/lib/permissions/bits";
import { createServerClient } from "@/lib/supabase/server";
import { donutSlices } from "@/lib/treasury/charts";
import { finalitySnapshot } from "@/lib/treasury/finality";
import { getDaoRaffles } from "@/lib/treasury/raffles";
import { getDaoHistory, getDaoOverview, getDaoRanking, getOperations } from "@/lib/treasury/queries";
import { settlePendingDonations, shouldSettleFromView } from "@/lib/treasury/settle";

export const metadata: Metadata = { title: "DAO" };

type Search = Promise<{ donar?: string | string[] }>;

// Lee cookies (dinámico): con cacheComponents debe vivir dentro de un Suspense.
async function DaoContent({ searchParams }: { searchParams: Search }) {
  const { donar } = await searchParams;
  const supabase = await createServerClient();
  const { data: me } = await supabase.rpc("current_member_id");
  const memberId = typeof me === "string" ? me : null;

  const [overview, ranking, history, operations, raffles, own, rawPerms, economy] = await Promise.all([
    getDaoOverview(supabase),
    getDaoRanking(supabase, 50),
    getDaoHistory(supabase, 50),
    getOperations(supabase, 30),
    // A raffle read that fails must not take the whole page down.
    getDaoRaffles(supabase, 20).catch((e) => {
      console.error("[treasury] dao raffles read failed", safeError(e));
      return [];
    }),
    memberId ? supabase.from("members").select("dao_ranking_visible").eq("id", memberId).maybeSingle<{ dao_ranking_visible: boolean }>() : null,
    supabase.rpc("my_permissions"),
    getEconomyConfig(),
  ]);
  // Treasurers annotate the Safe's operations (set_operation_note re-checks MANAGE_TREASURY).
  const canNote = hasPerm(BigInt(String(rawPerms.data ?? 0)), Perm.MANAGE_TREASURY);
  const safe = economy.chains[overview.chainId].safe;
  // The estimate costs one RPC read: only when the viewer has something waiting for finality.
  const finality = overview.myPending.length > 0 ? await finalitySnapshot(overview.chainId) : undefined;
  // Viewing the DAO settles whatever is already final (anyone's, a few per view) without waiting for the cron or the
  // donor's next visit; a credit then reaches every open /dao through DaoLive.
  const chainId = overview.chainId;
  if (shouldSettleFromView()) {
    after(() => settlePendingDonations(chainId, { limit: 5 }).catch((e) => console.error("[treasury] dao page settle failed", safeError(e))));
  }

  return (
    <div className="flex w-full flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1">DAO</h1>
        <p className="text-fg-muted">La tesorería común del club en esta red. Aportar te da participaciones en su registro.</p>
        <div className="flex flex-wrap items-center gap-x-4">
          <HowItWorksLink section="dao" />
          {canNote ? (
            <Link
              href="/dao/tesoreria"
              className="inline-flex min-h-11 items-center rounded-control text-sm font-bold text-accent underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              Panel del tesorero
            </Link>
          ) : null}
        </div>
      </header>

      {/* Live: any donation recorded, credited or reverted (or a ranking opt-in) re-renders this page. */}
      <DaoLive />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <DaoOverview
          data={overview}
          donate={<DonateButton autoOpen={donar === "1"} />}
          finality={finality}
          withdraw={<WithdrawControls data={overview} />}
          chart={<NavChart navAt={overview.navAt} />}
        />
        <div className="flex flex-col gap-6">
          <section aria-labelledby="composition-title" className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6">
            <h2 id="composition-title" className="text-h2">
              Composición
            </h2>
            <FundComposition composition={overview.composition} />
          </section>
          <section aria-labelledby="split-title" className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6">
            <h2 id="split-title" className="text-h2">
              Reparto
            </h2>
            <ShareDonut slices={donutSlices(ranking)} donors={overview.donors} />
          </section>
        </div>
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

      <section
        id="operaciones"
        aria-labelledby="operations-title"
        className="flex scroll-mt-20 flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="operations-title" className="text-h2">
            Operaciones
          </h2>
          {safe ? (
            <a
              href={explorerAddress(overview.chainId, safe)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center rounded-control text-sm font-bold text-accent underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              Ver la Safe en el explorador
            </a>
          ) : null}
        </div>
        <p className="text-[13px] text-fg-muted">
          Movimientos de la Safe fuera de las donaciones. Cada salida debe llevar una nota del tesorero; si no, aparece como «Sin explicar».
        </p>
        <OperationsList operations={operations} chainId={overview.chainId} canNote={canNote} />
      </section>

      <section
        id="sorteos"
        aria-labelledby="raffles-title"
        className="flex scroll-mt-20 flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6"
      >
        <h2 id="raffles-title" className="text-h2">
          Sorteos
        </h2>
        <p className="text-[13px] text-fg-muted">
          El premio sale del fondo. El ganador se decide con una semilla secreta del foro y el primer bloque de Linea posterior al cierre, y cualquiera puede
          comprobarlo en su navegador.
        </p>
        <RaffleList raffles={raffles} unlockedShares={overview.myShares > overview.myLockedShares ? overview.myShares - overview.myLockedShares : 0n} />
      </section>

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
