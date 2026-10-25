import { describe, expect, it, vi } from "vitest";
import { findTransfer, SCAN_CHUNK, SCAN_WINDOW } from "@/lib/multisend/find-transfer";

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const TO = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const h = (n: number) => `0x${n.toString(16).padStart(2, "0").repeat(32)}` as `0x${string}`;
type Log = { transactionHash: `0x${string}` | null; args: { value?: bigint } };

function client(latest: bigint, logsFor: (from: bigint, to: bigint) => Log[] | Error) {
  const getLogs = vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
    const r = logsFor(fromBlock, toBlock);
    if (r instanceof Error) throw r;
    return r;
  });
  return { getBlockNumber: vi.fn(async () => latest), getLogs };
}

describe("findTransfer (C1)", () => {
  it("asks USDC Transfer logs with topic1 = wallet and topic2 = recipient, from the stored block, and matches value == amount", async () => {
    const c = client(1_000n, () => [
      { transactionHash: h(1), args: { value: 5n } },
      { transactionHash: h(2), args: { value: 7_500_000n } },
    ]);
    await expect(findTransfer(c as never, { usdc: USDC, from: OWNER, to: TO, amount: 7_500_000n, fromBlock: 900n })).resolves.toBe(h(2));
    const args = c.getLogs.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(args).toMatchObject({ address: USDC, args: { from: OWNER, to: TO }, fromBlock: 900n, toBlock: 1_000n });
    expect((args.event as { name: string }).name).toBe("Transfer");
  });

  it("no match is null; a hash already used by another line is skipped", async () => {
    const c = client(1_000n, () => [{ transactionHash: h(2), args: { value: 7n } }]);
    await expect(findTransfer(c as never, { usdc: USDC, from: OWNER, to: TO, amount: 8n, fromBlock: 1n })).resolves.toBeNull();
    await expect(findTransfer(c as never, { usdc: USDC, from: OWNER, to: TO, amount: 7n, fromBlock: 1n, exclude: new Set([h(2)]) })).resolves.toBeNull();
  });

  it("scans at most SCAN_WINDOW blocks in SCAN_CHUNK chunks; without a stored block, the last window up to latest", async () => {
    const ranges: Array<[bigint, bigint]> = [];
    const c = client(10n ** 7n, (a, b) => {
      ranges.push([a, b]);
      return [];
    });
    await findTransfer(c as never, { usdc: USDC, from: OWNER, to: TO, amount: 1n, fromBlock: 100n });
    expect(ranges[0]).toEqual([100n, 100n + SCAN_CHUNK - 1n]);
    expect(ranges.at(-1)![1]).toBe(100n + SCAN_WINDOW);
    expect(ranges.length).toBe(Number(SCAN_WINDOW / SCAN_CHUNK) + 1);
    ranges.length = 0;
    await findTransfer(c as never, { usdc: USDC, from: OWNER, to: TO, amount: 1n });
    expect(ranges[0]![0]).toBe(10n ** 7n - SCAN_WINDOW);
    expect(ranges.at(-1)![1]).toBe(10n ** 7n);
  });

  it("an RPC error propagates (the caller keeps the line «sin confirmar», never resendable)", async () => {
    const c = client(1_000n, () => new Error("range too large"));
    await expect(findTransfer(c as never, { usdc: USDC, from: OWNER, to: TO, amount: 1n, fromBlock: 1n })).rejects.toThrow("range too large");
  });
});
