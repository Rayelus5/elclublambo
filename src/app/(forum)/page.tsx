import { Suspense } from "react";
import { PageLoader } from "@/components/shell/page-loader";
import Link from "next/link";
import {
  ActiveChannelsList,
  DaoSummary,
  HomeCard,
  OpenBountiesList,
  PinnedList,
  UnreadBanner,
} from "@/components/home/home-sections";
import { getActiveChannels, getHomePins, getOpenBounties, getUnreadSummary } from "@/lib/home/queries";
import { createServerClient } from "@/lib/supabase/server";
import { getEconomyConfig } from "@/lib/economy/config";
import { getDaoOverview } from "@/lib/treasury/queries";

// Each section settles on its own: a failing read shows a short error in its card instead of blanking the page.
async function HomeContent() {
  const supabase = await createServerClient();
  const daoEnabled = (await getEconomyConfig()).legacyDaoEnabled;
  const [unread, bounties, dao, pins, active] = await Promise.allSettled([
    getUnreadSummary(supabase),
    getOpenBounties(supabase, 5),
    daoEnabled ? getDaoOverview(supabase) : Promise.resolve(null),
    getHomePins(supabase, 5),
    getActiveChannels(supabase, 8),
  ]);

  return (
    <div className="flex w-full flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1">Inicio</h1>
        <p className="text-fg-muted">Lo importante del club de un vistazo.</p>
      </header>

      {unread.status === "fulfilled" ? <UnreadBanner unread={unread.value} /> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <HomeCard
          id="home-bounties"
          title="Bounties abiertos"
          failed={bounties.status === "rejected"}
          action={
            <Link href="/guia/bounties" className="text-[13px] text-fg-muted underline-offset-4 hover:text-fg hover:underline">
              ¿Cómo funcionan?
            </Link>
          }
        >
          {bounties.status === "fulfilled" ? <OpenBountiesList bounties={bounties.value} /> : null}
        </HomeCard>
        {daoEnabled ? (
          <HomeCard id="home-dao" title="DAO" failed={dao.status === "rejected"}>
            {dao.status === "fulfilled" && dao.value ? <DaoSummary overview={dao.value} /> : null}
          </HomeCard>
        ) : null}
      </div>

      <HomeCard id="home-pins" title="Anuncios fijados" failed={pins.status === "rejected"}>
        {pins.status === "fulfilled" ? <PinnedList pins={pins.value} /> : null}
      </HomeCard>

      <HomeCard id="home-active" title="Actividad reciente" failed={active.status === "rejected"}>
        {active.status === "fulfilled" ? <ActiveChannelsList channels={active.value} /> : null}
      </HomeCard>
    </div>
  );
}

export default function InicioPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <HomeContent />
    </Suspense>
  );
}
