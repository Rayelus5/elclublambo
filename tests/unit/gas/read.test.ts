// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeAbiParameters, type PublicClient } from "viem";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));
vi.mock("@/lib/payments/chain-client", () => ({ chainClient: vi.fn() }));
vi.mock("@/lib/economy/eth-price", () => ({ readEthUsd: vi.fn() }));

import { cacheLife } from "next/cache";
import { readEthUsd } from "@/lib/economy/eth-price";
import { chainClient } from "@/lib/payments/chain-client";
import { GAS_ACTIONS, OP_TX_ENVELOPE_BYTES } from "@/lib/gas/actions";
import { GAS_PRICE_ORACLE, NODE_INTERFACE, nodeInterfaceAbi } from "@/lib/gas/oracles-abi";
import { GAS_CACHE, getGasSnapshot, readGasSnapshot, readNetworkGas } from "@/lib/gas/read";

const BASE = 84532 as const;
const ARB = 421614 as const;
const GWEI = 1_000_000_000n;

type Mock = {
  getBlock: ReturnType<typeof vi.fn>;
  estimateMaxPriorityFeePerGas: ReturnType<typeof vi.fn>;
  readContract: ReturnType<typeof vi.fn>;
  call: ReturnType<typeof vi.fn>;
};

function baseClient(opts: { l1Fee?: bigint | "revert"; l1BaseFee?: bigint | "revert" } = {}): Mock {
  return {
    getBlock: vi.fn(async () => ({ baseFeePerGas: GWEI })),
    estimateMaxPriorityFeePerGas: vi.fn(async () => GWEI / 10n),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      const v = functionName === "l1BaseFee" ? (opts.l1BaseFee ?? 3n * GWEI) : (opts.l1Fee ?? 5_000_000_000_000n);
      if (v === "revert") throw new Error("execution reverted");
      return v;
    }),
    call: vi.fn(),
  };
}

function arbClient(l1Gas: bigint | "revert" = 1000n): Mock {
  return {
    getBlock: vi.fn(async () => ({ baseFeePerGas: GWEI / 100n })),
    estimateMaxPriorityFeePerGas: vi.fn(async () => 0n),
    readContract: vi.fn(),
    call: vi.fn(async () => {
      if (l1Gas === "revert") throw new Error("execution reverted");
      return { data: encodeAbiParameters([{ type: "uint64" }, { type: "uint256" }, { type: "uint256" }], [l1Gas, 0n, 0n]) };
    }),
  };
}

const asClient = (m: Mock) => m as unknown as PublicClient;
const row = (rows: { action: string }[], action: string) => rows.find((r) => r.action === action)!;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(readEthUsd).mockResolvedValue({ priceE8: 2000_00000000n });
});

describe("readNetworkGas: Base (OP Stack)", () => {
  it("L2 = gas × (base + tip); L1 = the oracle's upper bound, asked for calldata + the tx envelope", async () => {
    const c = baseClient();
    const r = await readNetworkGas(BASE, asClient(c));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.baseFeeWei).toBe(String(GWEI));
    expect(r.priorityWei).toBe(String(GWEI / 10n));
    expect(r.l1Status).toBe("ok");
    const eth = row(r.rows, "ethTransfer") as (typeof r.rows)[number];
    expect(eth.l2Wei).toBe(String(21_000n * 1_100_000_000n));
    expect(eth.l1Wei).toBe("5000000000000");
    expect(eth.totalWei).toBe(String(21_000n * 1_100_000_000n + 5_000_000_000_000n));
    expect(r.rows.map((x) => x.action)).toEqual(GAS_ACTIONS.map((a) => a.key));
    const asked = c.readContract.mock.calls.map(([p]) => p as { address: string; functionName: string; args: [bigint] });
    expect(asked.every((p) => p.address === GAS_PRICE_ORACLE && p.functionName === "getL1FeeUpperBound")).toBe(true);
    expect(asked.map((p) => p.args[0])).toEqual(GAS_ACTIONS.map((a) => BigInt(a.calldataBytes + OP_TX_ENVELOPE_BYTES)));
    expect(OP_TX_ENVELOPE_BYTES).toBe(110);
  });

  it("an oracle that reverts (Review Focus 5): no L1 part, total = L2, l1Status unavailable", async () => {
    const r = await readNetworkGas(BASE, asClient(baseClient({ l1Fee: "revert" })));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.l1Status).toBe("unavailable");
    for (const x of r.rows) {
      expect(x.l1Wei).toBeNull();
      expect(x.totalWei).toBe(x.l2Wei);
    }
  });

  it("a block read that throws makes the whole network unavailable", async () => {
    const c = baseClient();
    c.getBlock.mockRejectedValue(new Error("rpc down"));
    expect(await readNetworkGas(BASE, asClient(c))).toEqual({ status: "unavailable", chainId: BASE });
  });

  it("a tip read that rejects makes the network unavailable (no silent 0 tip)", async () => {
    const c = baseClient();
    c.estimateMaxPriorityFeePerGas.mockRejectedValue(new Error("rpc down"));
    expect(await readNetworkGas(BASE, asClient(c))).toEqual({ status: "unavailable", chainId: BASE });
  });

  it("a block with baseFeePerGas null (pre-London) makes the network unavailable", async () => {
    const c = baseClient();
    c.getBlock.mockResolvedValue({ baseFeePerGas: null });
    expect(await readNetworkGas(BASE, asClient(c))).toEqual({ status: "unavailable", chainId: BASE });
  });

  it("a client that cannot even be built is unavailable, never a throw", async () => {
    vi.mocked(chainClient).mockImplementation(() => {
      throw new Error("bad rpc url");
    });
    expect(await readNetworkGas(BASE)).toEqual({ status: "unavailable", chainId: BASE });
  });
});

describe("readNetworkGas: Arbitrum (Nitro)", () => {
  it("adds NodeInterface's gasEstimateForL1 to the L2 units, with deterministic filler calldata", async () => {
    const c = arbClient(1000n);
    const r = await readNetworkGas(ARB, asClient(c));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    const base = GWEI / 100n;
    const erc20 = row(r.rows, "erc20Transfer") as (typeof r.rows)[number];
    expect(erc20.totalWei).toBe(String((65_000n + 1000n) * base));
    expect(erc20.l2Wei).toBe(String(65_000n * base));
    expect(erc20.l1Wei).toBe(String(1000n * base));
    expect(r.l1Status).toBe("ok");

    const calls = c.call.mock.calls.map(([p]) => p as { to: string; data: `0x${string}` });
    expect(calls.every((p) => p.to === NODE_INTERFACE)).toBe(true);
    const sizes = calls.map((p) => {
      const d = decodeFunctionData({ abi: nodeInterfaceAbi, data: p.data });
      expect(d.functionName).toBe("gasEstimateL1Component");
      expect(d.args[1]).toBe(false);
      return (d.args[2].length - 2) / 2;
    });
    expect(sizes).toEqual(GAS_ACTIONS.map((a) => a.calldataBytes));
    // Deterministic: the same request twice.
    const again = arbClient(1000n);
    await readNetworkGas(ARB, asClient(again));
    expect(again.call.mock.calls.map(([p]) => (p as { data: string }).data)).toEqual(calls.map((p) => p.data));
  });

  it("a NodeInterface failure leaves the L2 cost, marked without L1", async () => {
    const r = await readNetworkGas(ARB, asClient(arbClient("revert")));
    expect(r.status === "ok" && r.l1Status).toBe("unavailable");
    if (r.status !== "ok") return;
    expect(r.rows.every((x) => x.l1Wei === null && x.totalWei === x.l2Wei)).toBe(true);
  });

  it("NodeInterface answering with no data counts as a failure: L2 only, marked without L1", async () => {
    const c = arbClient();
    c.call.mockResolvedValue({ data: undefined });
    const r = await readNetworkGas(ARB, asClient(c));
    expect(r.status === "ok" && r.l1Status).toBe("unavailable");
    if (r.status !== "ok") return;
    expect(r.rows.every((x) => x.l1Wei === null && x.totalWei === x.l2Wei)).toBe(true);
  });

  it("a non-zero tip on Arbitrum is added to the L2 price, for both the L2 and the L1 part", async () => {
    const c = arbClient(1000n);
    const tip = GWEI / 1000n;
    c.estimateMaxPriorityFeePerGas.mockResolvedValue(tip);
    const r = await readNetworkGas(ARB, asClient(c));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    const price = GWEI / 100n + tip;
    expect(r.priorityWei).toBe(String(tip));
    const erc20 = row(r.rows, "erc20Transfer") as (typeof r.rows)[number];
    expect(erc20.l2Wei).toBe(String(65_000n * price));
    expect(erc20.l1Wei).toBe(String(1000n * price));
    expect(erc20.totalWei).toBe(String(66_000n * price));
  });
});

describe("readGasSnapshot", () => {
  function wire(base: Mock, arb: Mock) {
    vi.mocked(chainClient).mockImplementation(((chain: number) => asClient(chain === BASE ? base : arb)) as typeof chainClient);
  }

  it("both networks, the Ethereum reference from Base's l1BaseFee, and the ETH price", async () => {
    wire(baseClient({ l1BaseFee: 3n * GWEI }), arbClient());
    const s = await readGasSnapshot();
    expect(s.networks.map((n) => [n.chainId, n.status])).toEqual([
      [BASE, "ok"],
      [ARB, "ok"],
    ]);
    expect(s.ethereum?.l1BaseFeeWei).toBe(String(3n * GWEI));
    expect(s.ethereum?.rows.find((x) => x.action === "ethTransfer")?.totalWei).toBe(String(21_000n * 3n * GWEI));
    expect(s.ethUsdE8).toBe("200000000000");
    expect(readEthUsd).toHaveBeenCalledWith(BASE);
    expect(Number.isNaN(Date.parse(s.readAt))).toBe(false);
  });

  it("one network down: the other stays ok", async () => {
    const arb = arbClient();
    arb.getBlock.mockRejectedValue(new Error("rpc down"));
    wire(baseClient(), arb);
    const s = await readGasSnapshot();
    expect(s.networks).toEqual([expect.objectContaining({ chainId: BASE, status: "ok" }), { status: "unavailable", chainId: ARB }]);
  });

  it("no ETH price: ethUsdE8 null", async () => {
    vi.mocked(readEthUsd).mockResolvedValue(null);
    wire(baseClient(), arbClient());
    expect((await readGasSnapshot()).ethUsdE8).toBeNull();
  });

  it("l1BaseFee reverting: no Ethereum reference", async () => {
    wire(baseClient({ l1BaseFee: "revert" }), arbClient());
    const s = await readGasSnapshot();
    expect(s.ethereum).toBeNull();
    expect(s.networks[0]?.status).toBe("ok");
  });

  it("getGasSnapshot caches for 15 s", async () => {
    wire(baseClient(), arbClient());
    await getGasSnapshot();
    expect(GAS_CACHE).toEqual({ stale: 15, revalidate: 15, expire: 60 });
    expect(cacheLife).toHaveBeenCalledWith(GAS_CACHE);
  });
});
