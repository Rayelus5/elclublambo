import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const perms = vi.hoisted(() => ({ value: "256" }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    rpc: async (fn: string) => ({ data: fn === "my_permissions" ? perms.value : fn === "current_member_id" ? "me" : null, error: null }),
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = async () => ({ data: { dao_ranking_visible: true }, error: null });
      return b;
    },
  }),
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), notFound: vi.fn() }));
vi.mock("@/lib/treasury/withdrawal-actions", () => ({}));
vi.mock("@/lib/economy/config", () => ({
  getEconomyConfig: async () => ({ activeChainId: 59141, minFeeBps: 0, withdrawalsEnabled: { 59144: false, 59141: false }, weightedRafflesEnabled: { 59144: false, 59141: false }, chains: { 59144: { safe: null, platform: null }, 59141: { safe: null, platform: null } } }),
}));
vi.mock("@/lib/treasury/finality", () => ({ finalitySnapshot: vi.fn() }));
vi.mock("@/lib/treasury/settle", () => ({ settlePendingDonations: vi.fn(), shouldSettleFromView: () => false }));
vi.mock("@/lib/treasury/queries", () => ({
  getDaoOverview: async () => ({ chainId: 59141, myPending: [], composition: null, donors: 0, navAt: null }),
  getDaoRanking: async () => [],
  getDaoHistory: async () => [],
  getOperations: async () => [],
}));
vi.mock("@/lib/treasury/charts", () => ({ donutSlices: () => [] }));

for (const path of [
  "dao-charts",
  "dao-history",
  "dao-live",
  "dao-overview",
  "dao-ranking",
  "donate-button",
  "fund-composition",
  "nav-chart",
  "operations-list",
  "withdraw-controls",
  "ranking-toggle",
]) {
  vi.doMock(`@/components/treasury/${path}`, () => {
    const Stub = () => null;
    return { ShareDonut: Stub, DaoHistory: Stub, DaoLive: Stub, DaoOverview: Stub, DaoRanking: Stub, DonateButton: Stub, FundComposition: Stub, NavChart: Stub, OperationsList: Stub, WithdrawControls: Stub, RankingToggle: Stub };
  });
}
vi.mock("@/components/treasury/raffles/raffle-list", () => ({ RaffleList: () => null }));
vi.mock("@/components/guide/how-it-works-link", () => ({ HowItWorksLink: () => null }));

beforeEach(() => {
  perms.value = "256";
});

async function dao(): Promise<ReactElement> {
  const { default: DaoPage } = await import("@/app/(forum)/dao/page");
  const suspense = DaoPage({ searchParams: Promise.resolve({}) }) as ReactElement<{ children: ReactElement }>;
  const el = suspense.props.children as ReactElement<object> & { type: (p: object) => Promise<ReactElement> };
  return el.type(el.props);
}

describe("/dao · Panel del tesorero link", () => {
  it("shows the link to /dao/tesoreria for MANAGE_TREASURY", async () => {
    render(await dao());
    expect(screen.getByRole("link", { name: "Panel del tesorero" })).toHaveAttribute("href", "/dao/tesoreria");
  }, 20_000);

  it("does not show it to a member", async () => {
    perms.value = "0";
    render(await dao());
    expect(screen.queryByRole("link", { name: "Panel del tesorero" })).toBeNull();
  });
});
