import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import type { Address } from "viem";
import { DaoLive } from "@/components/treasury/dao-live";
import { OperationsList } from "@/components/treasury/operations-list";
import { CreateRaffleDialog } from "@/components/treasury/treasurer/create-raffle-dialog";
import { RafflesTable } from "@/components/treasury/treasurer/raffles-table";
import { TreasuryAlerts } from "@/components/treasury/treasurer/treasury-alerts";
import { WeightedRafflesSwitch } from "@/components/treasury/treasurer/weighted-raffles-switch";
import { WithdrawalsSwitch } from "@/components/treasury/treasurer/withdrawals-switch";
import { WithdrawalsTable } from "@/components/treasury/treasurer/withdrawals-table";
import { getEconomyConfig } from "@/lib/economy/config";
import { NETWORKS, type ChainId } from "@/lib/economy/networks";
import { hasPerm, Perm } from "@/lib/permissions/bits";
import { createServerClient } from "@/lib/supabase/server";
import { formatUsdc } from "@/lib/treasury/format";
import { formatWhen, treasuryAlerts } from "@/lib/treasury/panel";
import { getDaoOverview, getUnexplainedOutflows } from "@/lib/treasury/queries";
import { getTreasuryRaffles, type TreasuryRaffle } from "@/lib/treasury/raffles";
import { readSafeAssets } from "@/lib/treasury/valuation";
import { getTreasuryWithdrawals } from "@/lib/treasury/withdrawals";

export const metadata: Metadata = { title: "Panel del tesorero" };

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

function parsePerms(raw: unknown): bigint {
  const text = String(raw ?? "0");
  return /^\d+$/.test(text) ? BigInt(text) : 0n;
}

// Reads cookies (dynamic): under cacheComponents it must live inside a Suspense. The proxy answers 404 before this runs;
// the check here is the second wall (and the only one if the proxy failed open).
async function TreasuryContent() {
  const supabase = await createServerClient();
  const [rawPerms, me] = await Promise.all([supabase.rpc("my_permissions"), supabase.rpc("current_member_id")]);
  const perms = parsePerms(rawPerms.data);
  if (!hasPerm(perms, Perm.MANAGE_TREASURY)) notFound();
  const isSuperAdmin = hasPerm(perms, Perm.ADMINISTRATOR);
  const meId = typeof me.data === "string" ? me.data : null;

  const [economy, overview, withdrawals, unexplained, raffleResult] = await Promise.all([
    getEconomyConfig(),
    getDaoOverview(supabase),
    getTreasuryWithdrawals(supabase),
    getUnexplainedOutflows(supabase),
    getTreasuryRaffles(supabase).then(
      (rows) => ({ rows, failed: false }),
      (e: unknown) => {
        console.error("[treasury] panel raffles read failed", e);
        return { rows: [] as TreasuryRaffle[], failed: true };
      },
    ),
  ]);
  const raffles = raffleResult.rows;
  const chainId: ChainId = overview.chainId;
  const safe = economy.chains[chainId].safe;

  // The Safe's USDC, live; when the read fails the latest snapshot's, labelled with its time.
  let safeUsdc: bigint | null = null;
  let safeWeth: bigint | null = null;
  let snapshotAt: string | null = null;
  if (safe) {
    try {
      const assets = await readSafeAssets(chainId, safe as Address);
      safeUsdc = assets.usdc;
      safeWeth = assets.weth;
    } catch (e) {
      console.error("[treasury] panel Safe read failed", chainId, e);
    }
  }
  if (safeUsdc === null && overview.composition) {
    safeUsdc = overview.composition.usdcUnits;
    snapshotAt = overview.composition.takenAt;
  }

  // Members banned after asking can still be approved and paid (ruling F4c-R2): the panel only flags them.
  const open = withdrawals.filter((w) => w.status === "pending" || w.status === "approved");
  const winnerIds = raffles.filter((r) => r.status === "drawn" && r.winnerMemberId !== null).map((r) => r.winnerMemberId!);
  const ids = [...new Set([...open.map((w) => w.memberId), ...winnerIds])];
  let bannedIds: string[] = [];
  let bannedCheckFailed = false;
  if (ids.length > 0) {
    const { data, error } = await supabase.from("members").select("id, status").in("id", ids);
    if (error) {
      console.error("[treasury] panel banned lookup failed", error.message);
      bannedCheckFailed = true;
    } else {
      bannedIds = ((data ?? []) as { id: string; status: string }[]).filter((m) => m.status === "banned").map((m) => m.id);
    }
  }

  const alerts = treasuryAlerts({ withdrawals, safeUsdc, safeWeth, raffles, unexplained: unexplained.length, now: new Date() });

  return (
    <div className="flex w-full flex-col gap-8">
      <header className="flex flex-col gap-2">
        <Link
          href="/dao"
          className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-control text-sm font-bold text-accent outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <ArrowLeft aria-hidden className="size-4" />
          DAO
        </Link>
        <h1 className="text-h1">Panel del tesorero</h1>
        <p className="text-fg-muted">{`Retiradas y operaciones de la Safe en ${NETWORKS[chainId].name}.`}</p>
        {safeUsdc !== null ? (
          <p className="text-sm text-fg">
            {`USDC en la Safe: ${formatUsdc(safeUsdc)}`}
            {snapshotAt ? <span className="text-fg-muted">{` · último dato ${formatWhen(snapshotAt)}`}</span> : null}
          </p>
        ) : (
          <p className="text-sm text-fg-muted">No se pudo leer el saldo de USDC de la Safe.</p>
        )}
      </header>

      {bannedCheckFailed ? (
        <p role="status" className="flex items-start gap-2 rounded-control border border-warning p-3 text-sm text-warning">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          No se pudo comprobar si algún miembro con retirada abierta está baneado. Recarga la página antes de decidir.
        </p>
      ) : null}

      {/* Live: any change in the treasury re-renders this page through the same channel as /dao. */}
      <DaoLive />

      <Section id="retiradas-pendientes" title="Retiradas pendientes" intro="Aprobar fija el importe en USDC al valor de mercado del momento.">
        <WithdrawalsTable kind="pending" rows={withdrawals.filter((w) => w.status === "pending")} meId={meId} bannedIds={bannedIds} chainId={chainId} />
      </Section>

      <Section
        id="retiradas-aprobadas"
        title="Retiradas aprobadas"
        intro="Paga desde la Safe y pega el hash, o espera a que el foro detecte la transferencia. Caducan a los 14 días."
      >
        <WithdrawalsTable kind="approved" rows={withdrawals.filter((w) => w.status === "approved")} meId={meId} bannedIds={bannedIds} chainId={chainId} />
      </Section>

      <Section
        id="sorteos"
        title="Sorteos"
        intro="Crea sorteos y paga sus premios desde la Safe. El ganador sale solo al cerrar, de forma verificable."
      >
        {raffleResult.failed ? (
          <p role="status" className="flex items-start gap-2 rounded-control border border-warning p-3 text-sm text-warning">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            No se pudieron cargar los sorteos. Recarga la página.
          </p>
        ) : null}
        <CreateRaffleDialog
          weightedEnabled={economy.weightedRafflesEnabled[chainId]}
          navUsd6={overview.navUsd6}
          ethPriceE8={overview.composition?.ethPriceE8 ?? null}
        />
        <RafflesTable rows={raffles} bannedIds={bannedIds} chainId={chainId} />
        {isSuperAdmin ? (
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <h3 className="text-sm font-bold text-fg">Sorteos ponderados</h3>
            <p className="text-[13px] text-fg-muted">Sin él, nadie puede crear sorteos ponderados en esa red. Los ya creados siguen su curso.</p>
            <WeightedRafflesSwitch enabled={economy.weightedRafflesEnabled} />
          </div>
        ) : null}
      </Section>

      <Section id="avisos" title="Avisos">
        <TreasuryAlerts alerts={alerts} />
      </Section>

      <Section
        id="sin-explicar"
        title="Operaciones sin explicar"
        intro="Salidas de la Safe sin nota. Añade qué fueron para dejarlas explicadas."
      >
        {unexplained.length === 0 ? (
          <p className="text-fg-muted">No hay operaciones sin explicar.</p>
        ) : (
          <OperationsList operations={unexplained} chainId={chainId} canNote />
        )}
      </Section>

      {isSuperAdmin ? (
        <Section id="interruptor" title="Interruptor de retiradas" intro="Sin él, nadie puede pedir ni aprobar retiradas en esa red. Cancelar, rechazar y registrar pagos siguen disponibles.">
          <WithdrawalsSwitch enabled={economy.withdrawalsEnabled} />
        </Section>
      ) : null}

      <Section id="recientes" title="Recientes" intro="Retiradas cerradas en los últimos 30 días.">
        <WithdrawalsTable
          kind="recent"
          rows={withdrawals.filter((w) => w.status === "paid" || w.status === "rejected" || w.status === "cancelled")}
          meId={meId}
          bannedIds={bannedIds}
          chainId={chainId}
        />
      </Section>
    </div>
  );
}

export default function TreasuryPage() {
  return (
    <Suspense fallback={<div className="min-h-64" aria-hidden />}>
      <TreasuryContent />
    </Suspense>
  );
}
