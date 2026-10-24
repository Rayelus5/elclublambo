import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import { DonateButton } from "@/components/donations/donate-button";
import { DonationSummary, RecentDonations } from "@/components/donations/donation-summary";
import { DonorList } from "@/components/donations/donor-list";
import { DonorVisibilityToggle } from "@/components/donations/donor-visibility-toggle";
import { MecenasBadge } from "@/components/donations/mecenas-badge";
import { SafeBalances } from "@/components/donations/safe-balances";
import { PageLoader } from "@/components/shell/page-loader";
import { getDonationOverview, getDonorRanking, getMyDonorStatus } from "@/lib/donations/queries";
import { getSafeBalances } from "@/lib/donations/safe-balances";
import { getEconomyConfig } from "@/lib/economy/config";
import { appChainIds } from "@/lib/economy/networks";
import { safeError } from "@/lib/security/redact";
import { createServerClient } from "@/lib/supabase/server";
import { formatUsd } from "@/lib/treasury/format";

export const metadata: Metadata = { title: "Donar" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const READ_FAILED = "No se pudo cargar. Recarga la página.";

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} id={id} className="flex scroll-mt-20 flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-title`} className="text-h2">
          {title}
        </h2>
        {intro ? <p className="text-[13px] text-fg-muted">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** A failed read shows its own notice and leaves the rest of the page standing. */
function settle<T>(label: string, p: Promise<T>): Promise<T | null> {
  return p.catch((e: unknown) => {
    console.error(`[donations] ${label} read failed`, safeError(e));
    return null;
  });
}

/** On-chain reads (one RPC call per asset and network): streamed in their own boundary so the page never waits on them. */
async function SafeBalancesBlock() {
  const [balances, economy] = await Promise.all([getSafeBalances(), settle("economy config", getEconomyConfig())]);
  // The club Safe has the same address on every network (chains.safe_address).
  const safe = appChainIds().map((c) => economy?.safes[c]).find((s) => !!s) ?? null;
  return <SafeBalances balances={balances} safe={safe} />;
}

// Reads cookies (dynamic): under cacheComponents it must live inside a Suspense.
async function DonarContent({ searchParams }: { searchParams: SearchParams }) {
  const { donar } = await searchParams;
  const supabase = await createServerClient();
  const [overview, ranking, me] = await Promise.all([
    settle("overview", getDonationOverview(supabase)),
    settle("ranking", getDonorRanking(supabase, 50)),
    settle("my status", getMyDonorStatus(supabase)),
  ]);

  return (
    <div className="flex w-full flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-h1">Donar</h1>
        <p className="max-w-2xl text-fg-muted">
          Las donaciones van a la Safe del club en Base o Arbitrum, en USDC o ETH. Desde 1 USD donado tienes el rol Mecenas.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <DonateButton autoOpen={donar === "1"} />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section id="resumen" title="Resumen">
          {overview ? <DonationSummary overview={overview} /> : <p className="text-sm text-danger">{READ_FAILED}</p>}
        </Section>

        <Section id="safe" title="Saldos de la Safe" intro="Lo que la Safe tiene ahora en cada red, leído de la blockchain.">
          <Suspense fallback={<PageLoader label="Leyendo saldos…" className="min-h-24" />}>
            <SafeBalancesBlock />
          </Suspense>
        </Section>
      </div>

      <Section id="tu-estado" title="Tu estado">
        {me ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-fg-muted">
                Has donado <span className="font-mono font-bold text-fg tabular-nums">{formatUsd(me.totalUsd6)}</span>
              </p>
              {me.isMecenas ? <MecenasBadge /> : null}
            </div>
            <DonorVisibilityToggle initial={me.visible} />
          </div>
        ) : (
          <p className="text-sm text-danger">{READ_FAILED}</p>
        )}
      </Section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section id="donantes" title="Lista de donantes" intro="Apareces aquí al donar, salvo que lo desactives. Lo donado de forma anónima no suma a tu fila para los demás.">
          {ranking ? <DonorList rows={ranking} /> : <p className="text-sm text-danger">{READ_FAILED}</p>}
        </Section>

        <Section id="recientes" title="Donaciones recientes">
          {overview ? <RecentDonations items={overview.recent} /> : <p className="text-sm text-danger">{READ_FAILED}</p>}
        </Section>
      </div>

      {/* Gastos de la Safe: Task 6. */}

      <p role="note" className="border-t border-border pt-4 text-[13px] text-fg-muted">
        ElClub. no custodia fondos: la Safe la controlan sus firmantes. Donar no da derechos económicos.
      </p>
    </div>
  );
}

export default function DonarPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageLoader />}>
      <DonarContent searchParams={searchParams} />
    </Suspense>
  );
}
