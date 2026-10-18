import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { getDaoOverview } from "@/lib/treasury/queries";

function client(data: unknown): SupabaseClient {
  return { rpc: vi.fn().mockResolvedValue({ data, error: null }) } as unknown as SupabaseClient;
}

const RAW = {
  chainId: 59141,
  totalShares: "10000000000000000000",
  valueUsdc: "12000000",
  donors: 2,
  myShares: "8000000000000000000",
  myShareBps: 6666,
  myNet: "8000000",
  myPending: [],
  navUsd6: "12000000",
  navAt: "2026-10-18T10:00:00Z",
  sharePriceUsd6: "2000000",
  myValueUsd6: "8000000",
  clubShares: "0",
  composition: null,
};

describe("getDaoOverview — F4c withdrawal fields", () => {
  it("parses the switch, S_eff, my locked shares and my withdrawal as bigint without floats", async () => {
    const o = await getDaoOverview(
      client({
        ...RAW,
        withdrawalsEnabled: true,
        supplyShares: "6000000000000000000",
        myLockedShares: "4000000000000000000",
        myWithdrawal: {
          id: "w1",
          status: "approved",
          shares: "4000000000000000000",
          amountUsdc: "8000000",
          approvedAt: "2026-10-17T10:00:00+00:00",
          expiresAt: "2026-10-31T10:00:00+00:00",
          payoutRecorded: false,
          payoutTxHash: null,
          rejectReason: null,
          lastExpiredAt: null,
          createdAt: "2026-10-16T10:00:00+00:00",
        },
      }),
    );
    expect(o.withdrawalsEnabled).toBe(true);
    expect(o.supplyShares).toBe(6_000_000_000_000_000_000n);
    expect(o.myLockedShares).toBe(4_000_000_000_000_000_000n);
    expect(o.myWithdrawal).toEqual({
      id: "w1",
      status: "approved",
      shares: 4_000_000_000_000_000_000n,
      amountUsdc: 8_000_000n,
      approvedAt: "2026-10-17T10:00:00+00:00",
      expiresAt: "2026-10-31T10:00:00+00:00",
      payoutRecorded: false,
      payoutTxHash: null,
      rejectReason: null,
      lastExpiredAt: null,
      createdAt: "2026-10-16T10:00:00+00:00",
    });
  });

  it("defaults: switch off, no withdrawal, a pending request without amount", async () => {
    const none = await getDaoOverview(client({ ...RAW, myWithdrawal: null }));
    expect(none.withdrawalsEnabled).toBe(false);
    expect(none.supplyShares).toBe(0n);
    expect(none.myLockedShares).toBe(0n);
    expect(none.myWithdrawal).toBeNull();

    const pending = await getDaoOverview(
      client({
        ...RAW,
        myWithdrawal: {
          id: "w2", status: "pending", shares: "1", amountUsdc: null, approvedAt: null, expiresAt: null,
          payoutRecorded: false, payoutTxHash: null, rejectReason: null,
          lastExpiredAt: "2026-10-15T00:00:00+00:00", createdAt: "2026-10-01T00:00:00+00:00",
        },
      }),
    );
    expect(pending.myWithdrawal?.amountUsdc).toBeNull();
    expect(pending.myWithdrawal?.approvedAt).toBeNull();
    expect(pending.myWithdrawal?.lastExpiredAt).toBe("2026-10-15T00:00:00+00:00");
  });

  it("drops a withdrawal with an unknown status", async () => {
    const o = await getDaoOverview(client({ ...RAW, myWithdrawal: { id: "w3", status: "weird", shares: "1" } }));
    expect(o.myWithdrawal).toBeNull();
  });
});
