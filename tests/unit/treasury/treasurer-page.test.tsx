import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const perms = vi.hoisted(() => ({ value: "256" }));
const members = vi.hoisted(() => ({ rows: [] as { id: string; status: string }[], error: null as { message: string } | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    rpc: async (fn: string) => ({ data: fn === "my_permissions" ? perms.value : fn === "current_member_id" ? "me" : null, error: null }),
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.in = async () => ({ data: members.error ? null : members.rows, error: members.error });
      return b;
    },
  }),
}));

const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);
vi.mock("next/navigation", () => ({ notFound, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/treasury/withdrawal-actions", () => ({
  quoteWithdrawalAction: vi.fn(),
  approveWithdrawalAction: vi.fn(),
  rejectWithdrawalAction: vi.fn(),
  markWithdrawalPaidAction: vi.fn(),
  setWithdrawalsEnabledAction: vi.fn(),
}));
vi.mock("@/components/treasury/dao-live", () => ({ DaoLive: () => null }));

const SAFE = "0x00000000000000000000000000000000000000aa";
vi.mock("@/lib/economy/config", () => ({
  getEconomyConfig: async () => ({
    activeChainId: 59141,
    minFeeBps: 0,
    withdrawalsEnabled: { 59144: false, 59141: true },
    chains: { 59144: { safe: null, platform: null }, 59141: { safe: SAFE, platform: null } },
  }),
}));

const readSafeAssets = vi.hoisted(() => vi.fn());
vi.mock("@/lib/treasury/valuation", () => ({ readSafeAssets }));

const getTreasuryWithdrawals = vi.hoisted(() => vi.fn());
vi.mock("@/lib/treasury/withdrawals", async (orig) => ({ ...(await orig<object>()), getTreasuryWithdrawals }));

const overview = {
  chainId: 59141,
  composition: { usdcUnits: 4_000_000n, ethWei: 0n, wethWei: 0n, ethPriceE8: 0n, priceSource: "chainlink", takenAt: "2026-10-19T10:00:00Z" },
};
vi.mock("@/lib/treasury/queries", () => ({
  getDaoOverview: async () => overview,
  getUnexplainedOutflows: async () => [
    { id: "o1", asset: "USDC", direction: "out", amount: 1_000_000n, txHash: null, occurredAt: "2026-10-19T09:00:00Z", note: null, explained: false },
  ],
}));

import TesoreriaPage from "@/app/(forum)/dao/tesoreria/page";

/** Page -> <Suspense><Content/></Suspense>: runs the async server component directly. */
async function content(): Promise<ReactElement> {
  const suspense = TesoreriaPage() as ReactElement<{ children: ReactElement }>;
  const el = suspense.props.children as ReactElement<object> & { type: (p: object) => Promise<ReactElement> };
  return el.type(el.props);
}

beforeEach(() => {
  perms.value = "256";
  members.rows = [];
  members.error = null;
  notFound.mockClear();
  readSafeAssets.mockReset();
  readSafeAssets.mockResolvedValue({ usdc: 10_000_000n, eth: 0n, weth: 0n, blockNumber: 1n });
  getTreasuryWithdrawals.mockReset();
  getTreasuryWithdrawals.mockResolvedValue([]);
});

describe("/dao/tesoreria", () => {
  it("is a 404 for a member without MANAGE_TREASURY", async () => {
    perms.value = "8";
    await expect(content()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getTreasuryWithdrawals).not.toHaveBeenCalled();
  });

  it("shows the sections in order, the live Safe USDC and no switch for a bit-256 treasurer", async () => {
    render(await content());
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Retiradas pendientes", "Retiradas aprobadas", "Avisos", "Operaciones sin explicar", "Recientes"]);
    expect(screen.queryByText("Interruptor de retiradas")).toBeNull();
    expect(screen.getByText(/USDC en la Safe: 10 USDC/)).toBeInTheDocument();
    expect(screen.getByText(/1 salida sin explicar/)).toBeInTheDocument();
  });

  it("adds the switch section (before Recientes) for ADMINISTRATOR", async () => {
    perms.value = "768";
    render(await content());
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "Retiradas pendientes",
      "Retiradas aprobadas",
      "Avisos",
      "Operaciones sin explicar",
      "Interruptor de retiradas",
      "Recientes",
    ]);
    expect(screen.getByRole("switch", { name: "Retiradas en Linea Sepolia" })).toHaveAttribute("aria-checked", "true");
  });

  it("falls back to the latest snapshot's USDC, with its time, when the live read fails", async () => {
    readSafeAssets.mockRejectedValue(new Error("rpc down"));
    render(await content());
    expect(screen.getByText(/USDC en la Safe: 4 USDC/)).toBeInTheDocument();
    expect(screen.getByText(/último dato/i)).toBeInTheDocument();
  });

  it("flags a banned member's request", async () => {
    getTreasuryWithdrawals.mockResolvedValue([
      {
        id: "w1", memberId: "m1", memberLabel: "@ana", wallet: SAFE, shares: 1n, positionShares: 2n, status: "pending",
        createdAt: "2026-10-18T10:00:00Z", approvedAt: null, expiresAt: null, approvedByLabel: null, selfApproved: false,
        amountUsdc: null, estimateUsd6: null, lastExpiredAt: null, rejectReason: null, payoutTxHash: null, payoutAmount: null,
        payoutRecordedAt: null, paidAt: null, payoutLinked: false, rejectedAt: null, cancelledAt: null,
      },
    ]);
    members.rows = [{ id: "m1", status: "banned" }];
    render(await content());
    expect(screen.getByText("Miembro baneado")).toBeInTheDocument();
  });

  it("warns instead of silently dropping the banned flags when the lookup fails", async () => {
    getTreasuryWithdrawals.mockResolvedValue([
      {
        id: "w1", memberId: "m1", memberLabel: "@ana", wallet: SAFE, shares: 1n, positionShares: 2n, status: "pending",
        createdAt: "2026-10-18T10:00:00Z", approvedAt: null, expiresAt: null, approvedByLabel: null, selfApproved: false,
        amountUsdc: null, estimateUsd6: null, lastExpiredAt: null, rejectReason: null, payoutTxHash: null, payoutAmount: null,
        payoutRecordedAt: null, paidAt: null, payoutLinked: false, rejectedAt: null, cancelledAt: null,
      },
    ]);
    members.error = { message: "boom" };
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(await content());
    expect(screen.getByRole("status")).toHaveTextContent("No se pudo comprobar si algún miembro");
  });
});
