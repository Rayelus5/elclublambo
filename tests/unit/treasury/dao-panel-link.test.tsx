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

// Every heavy child of the page is stubbed with a hoisted vi.mock, and the page is imported statically below: its module
// graph loads while the file is collected, never inside a test's time budget. (It used to be a dynamic import in the
// first test, which under full-suite parallel load could take longer than the test timeout: the flake.)
vi.mock("@/components/treasury/dao-charts", () => ({ ShareDonut: () => null }));
vi.mock("@/components/treasury/dao-history", () => ({ DaoHistory: () => null }));
vi.mock("@/components/treasury/dao-live", () => ({ DaoLive: () => null }));
vi.mock("@/components/treasury/dao-overview", () => ({ DaoOverview: () => null }));
vi.mock("@/components/treasury/dao-ranking", () => ({ DaoRanking: () => null }));
vi.mock("@/components/treasury/donate-button", () => ({ DonateButton: () => null }));
vi.mock("@/components/treasury/fund-composition", () => ({ FundComposition: () => null }));
vi.mock("@/components/treasury/nav-chart", () => ({ NavChart: () => null }));
vi.mock("@/components/treasury/operations-list", () => ({ OperationsList: () => null }));
vi.mock("@/components/treasury/withdraw-controls", () => ({ WithdrawControls: () => null }));
vi.mock("@/components/treasury/ranking-toggle", () => ({ RankingToggle: () => null }));
vi.mock("@/components/treasury/raffles/raffle-list", () => ({ RaffleList: () => null }));
vi.mock("@/components/guide/how-it-works-link", () => ({ HowItWorksLink: () => null }));

import DaoPage from "@/app/(forum)/dao/page";

beforeEach(() => {
  perms.value = "256";
});

async function dao(): Promise<ReactElement> {
  const suspense = DaoPage({ searchParams: Promise.resolve({}) }) as ReactElement<{ children: ReactElement }>;
  const el = suspense.props.children as ReactElement<object> & { type: (p: object) => Promise<ReactElement> };
  return el.type(el.props);
}

describe("/dao · Panel del tesorero link", () => {
  it("shows the link to /dao/tesoreria for MANAGE_TREASURY", async () => {
    render(await dao());
    expect(screen.getByRole("link", { name: "Panel del tesorero" })).toHaveAttribute("href", "/dao/tesoreria");
  });

  it("does not show it to a member", async () => {
    perms.value = "0";
    render(await dao());
    expect(screen.queryByRole("link", { name: "Panel del tesorero" })).toBeNull();
  });
});
