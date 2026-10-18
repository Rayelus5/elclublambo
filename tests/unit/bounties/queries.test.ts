import { describe, expect, it, vi } from "vitest";
import { getBountyDetails, getMemberBountyRecord, getMemberUnpaidBounties } from "@/lib/bounties/queries";

const client = (result: unknown) => ({ rpc: vi.fn(async () => result) }) as never;

describe("bounty queries", () => {
  it("maps bounty_details rows, keeping exact amounts", async () => {
    const m = await getBountyDetails(
      client({
        data: [
          { message_id: "a", token: "ETH", amount_text: "100000000000000000001", chain_id: 59141, status: "solution_marked", solution_message_id: "r", solver_id: "s", solution_marked_at: "t", pay_deadline: "d", paid_tip_id: null },
          { message_id: "bad", token: "DAI", amount_text: "1", chain_id: 59141, status: "open" },
        ],
        error: null,
      }),
      ["a", "bad"],
    );
    expect(m?.size).toBe(1);
    expect(m?.get("a")).toMatchObject({ amount: 100000000000000000001n, status: "solution_marked", payDeadline: "d", solverId: "s", paidTipId: null });
  });
  it("returns an empty map for no ids and null on failure", async () => {
    expect((await getBountyDetails(client({}), []))?.size).toBe(0);
    expect(await getBountyDetails(client({ data: null, error: { message: "x" } }), ["a"])).toBeNull();
  });
  it("maps the record and the unpaid list", async () => {
    expect(await getMemberBountyRecord(client({ data: [{ paid: 2, paid_late: 1, unpaid: 3, open: 4 }], error: null }), "m")).toEqual({ paid: 2, paidLate: 1, unpaid: 3, open: 4 });
    expect(await getMemberBountyRecord(client({ data: [], error: null }), "m")).toEqual({ paid: 0, paidLate: 0, unpaid: 0, open: 0 });
    const u = await getMemberUnpaidBounties(client({ data: [{ message_id: "a", channel_id: "c", token: "USDC", amount_text: "5000000", solution_marked_at: "t" }], error: null }), "m");
    expect(u).toEqual([{ messageId: "a", channelId: "c", token: "USDC", amount: 5000000n, solutionMarkedAt: "t" }]);
    await expect(getMemberUnpaidBounties(client({ data: null, error: { message: "x" } }), "m")).rejects.toBeTruthy();
  });
});
