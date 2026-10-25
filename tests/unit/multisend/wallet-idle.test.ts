import { describe, expect, it, vi } from "vitest";
import { readWalletIdle } from "@/lib/multisend/wallet-idle";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;

function client(pending: number, latest: number | Error) {
  return {
    getTransactionCount: vi.fn(async ({ blockTag }: { blockTag: string }) => {
      if (blockTag === "pending") return pending;
      if (latest instanceof Error) throw latest;
      return latest;
    }),
  };
}

describe("R1: readWalletIdle", () => {
  it("compares the pending and latest nonces of the address", async () => {
    const c = client(5, 5);
    await expect(readWalletIdle(c as never, OWNER)).resolves.toBe("idle");
    expect(c.getTransactionCount).toHaveBeenCalledWith({ address: OWNER, blockTag: "pending" });
    expect(c.getTransactionCount).toHaveBeenCalledWith({ address: OWNER, blockTag: "latest" });
    await expect(readWalletIdle(client(6, 5) as never, OWNER)).resolves.toBe("pending");
  });

  it("a failed read throws (the callers treat it as not idle)", async () => {
    await expect(readWalletIdle(client(5, new Error("rpc")) as never, OWNER)).rejects.toThrow("rpc");
  });
});
