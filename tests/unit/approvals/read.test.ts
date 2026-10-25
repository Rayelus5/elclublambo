// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  HttpRequestError,
  maxUint256,
  RpcRequestError,
  TimeoutError,
  type PublicClient,
  erc20Abi,
} from "viem";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/payments/chain-client", () => ({ chainClient: vi.fn() }));
vi.mock("@/lib/approvals/discover", async (orig) => ({ ...(await orig<typeof import("@/lib/approvals/discover")>()), discoverApprovalPairs: vi.fn() }));

import { chainClient } from "@/lib/payments/chain-client";
import { discoverApprovalPairs } from "@/lib/approvals/discover";
import { checkAllowance, MAX_PAIRS, readAllowances, scanApprovals } from "@/lib/approvals/read";
import { UNLIMITED_THRESHOLD } from "@/lib/approvals/types";
import { PERMIT2 } from "@/lib/approvals/spenders";

const CHAIN = 8453 as const;
const OWNER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;
const TOKEN = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const TOKEN_2 = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" as const;
const CONTRACT_SPENDER = "0x1111111111111111111111111111111111111111" as const;
const EOA_SPENDER = "0x2222222222222222222222222222222222222222" as const;

type Call = { address: string; functionName: string; args?: readonly unknown[] };
type Answer = { status: "success"; result: unknown } | { status: "failure"; error: Error };

const revert = () =>
  new ContractFunctionExecutionError(new ContractFunctionRevertedError({ abi: erc20Abi, functionName: "allowance" }), {
    abi: erc20Abi,
    functionName: "allowance",
    args: [OWNER, TOKEN],
    contractAddress: TOKEN,
  });
const transport = () => new HttpRequestError({ url: "http://rpc", status: 503 });
/** A JSON-RPC error body for the whole aggregate3 call (viem copies the same error into every result of the chunk). */
const internal = () => new RpcRequestError({ body: {}, error: { code: -32603, message: "internal error" }, url: "http://rpc" });
const headerNotFound = () => new RpcRequestError({ body: {}, error: { code: -32000, message: "header not found" }, url: "http://rpc" });
/** The node answered `0x` to aggregate3 itself (no Multicall3, a pruned node...). */
const aggregateZeroData = () =>
  new ContractFunctionExecutionError(new ContractFunctionZeroDataError({ functionName: "aggregate3" }), {
    abi: [{ type: "function", name: "aggregate3", stateMutability: "view", inputs: [], outputs: [] }],
    functionName: "aggregate3",
    args: [],
    contractAddress: "0xcA11bde05977b3631167028862bE2a173976CA11",
  });
/** What a fallback transport rethrows once every transport failed. */
const fallbackFailed = () => new Error("all transports failed");
const rpcTimeout = () => new TimeoutError({ body: {}, url: "http://rpc" });
const rpc429 = () => new HttpRequestError({ url: "http://rpc", status: 429 });

/**
 * A fake viem client: `allowances` keyed by `${token}:${spender}` (lowercase), symbol/decimals per token, code per address.
 * An Error value is that call's failure (allowFailure: true), as viem's multicall reports it.
 */
function fakeClient(opts: {
  allowances?: Record<string, bigint | Error>;
  symbols?: Record<string, string | Error>;
  decimals?: Record<string, number | Error>;
  code?: Record<string, string | Error>;
}) {
  const answer = (v: unknown): Answer => (v instanceof Error ? { status: "failure", error: v } : { status: "success", result: v });
  const multicall = vi.fn(async ({ contracts, allowFailure }: { contracts: Call[]; allowFailure: boolean }) => {
    expect(allowFailure).toBe(true);
    return contracts.map((c) => {
      const t = c.address.toLowerCase();
      if (c.functionName === "allowance") {
        expect((c.args![0] as string).toLowerCase()).toBe(OWNER.toLowerCase());
        return answer(opts.allowances?.[`${t}:${(c.args![1] as string).toLowerCase()}`] ?? 0n);
      }
      if (c.functionName === "symbol") return answer(opts.symbols?.[t] ?? "USDC");
      if (c.functionName === "decimals") return answer(opts.decimals?.[t] ?? 6);
      throw new Error(`unexpected ${c.functionName}`);
    });
  });
  const getCode = vi.fn(async ({ address }: { address: string }) => {
    const v = opts.code?.[address.toLowerCase()] ?? "0x6080";
    if (v instanceof Error) throw v;
    return v === "0x" ? undefined : v;
  });
  return { client: { multicall, getCode } as unknown as PublicClient, multicall, getCode };
}

const key = (t: string, s: string) => `${t.toLowerCase()}:${s.toLowerCase()}`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("readAllowances (P6-R2b)", () => {
  it("lists only allowances > 0, with symbol and decimals", async () => {
    const { client } = fakeClient({ allowances: { [key(TOKEN, CONTRACT_SPENDER)]: 5_000_000n, [key(TOKEN_2, CONTRACT_SPENDER)]: 0n } });
    const r = await readAllowances(CHAIN, OWNER, [{ token: TOKEN, spender: CONTRACT_SPENDER }, { token: TOKEN_2, spender: CONTRACT_SPENDER }], client);
    expect(r).toEqual({
      partial: false,
      rows: [
        {
          token: TOKEN,
          symbol: "USDC",
          decimals: 6,
          spender: CONTRACT_SPENDER,
          spenderLabel: null,
          spenderKind: "unknown_contract",
          allowance: "5000000",
          unlimited: false,
        },
      ],
    });
  });

  it("maxUint256 is unlimited; 2^255 - 1 is not", async () => {
    expect(UNLIMITED_THRESHOLD).toBe(2n ** 255n);
    const { client } = fakeClient({
      allowances: { [key(TOKEN, CONTRACT_SPENDER)]: maxUint256, [key(TOKEN_2, CONTRACT_SPENDER)]: 2n ** 255n - 1n },
    });
    const r = await readAllowances(CHAIN, OWNER, [{ token: TOKEN, spender: CONTRACT_SPENDER }, { token: TOKEN_2, spender: CONTRACT_SPENDER }], client);
    expect(r.rows.map((x) => [x.token, x.unlimited, x.allowance])).toEqual([
      [TOKEN, true, maxUint256.toString()],
      [TOKEN_2, false, (2n ** 255n - 1n).toString()],
    ]);
  });

  it("a spender without code is an EOA; a known spender is labelled (even before its code)", async () => {
    const { client, getCode } = fakeClient({
      allowances: { [key(TOKEN, EOA_SPENDER)]: 1n, [key(TOKEN, PERMIT2)]: 1n, [key(TOKEN_2, EOA_SPENDER)]: 2n },
      code: { [EOA_SPENDER.toLowerCase()]: "0x" },
    });
    const r = await readAllowances(
      CHAIN,
      OWNER,
      [{ token: TOKEN, spender: EOA_SPENDER }, { token: TOKEN, spender: PERMIT2 }, { token: TOKEN_2, spender: EOA_SPENDER }],
      client,
    );
    expect(r.rows.map((x) => [x.spender, x.spenderKind, x.spenderLabel])).toEqual([
      [EOA_SPENDER, "eoa", null],
      [PERMIT2, "known", "Permit2"],
      [EOA_SPENDER, "eoa", null],
    ]);
    // getCode once per distinct spender
    expect(getCode).toHaveBeenCalledTimes(2);
  });

  it("a spender whose code cannot be read is an unknown contract, never «safe»", async () => {
    const { client } = fakeClient({ allowances: { [key(TOKEN, EOA_SPENDER)]: 1n }, code: { [EOA_SPENDER.toLowerCase()]: transport() } });
    const r = await readAllowances(CHAIN, OWNER, [{ token: TOKEN, spender: EOA_SPENDER }], client);
    expect(r.rows[0]!.spenderKind).toBe("unknown_contract");
  });

  it("omits a token whose allowance reverts", async () => {
    const { client } = fakeClient({ allowances: { [key(TOKEN, CONTRACT_SPENDER)]: revert(), [key(TOKEN_2, CONTRACT_SPENDER)]: 3n } });
    const r = await readAllowances(CHAIN, OWNER, [{ token: TOKEN, spender: CONTRACT_SPENDER }, { token: TOKEN_2, spender: CONTRACT_SPENDER }], client);
    expect(r.rows.map((x) => x.token)).toEqual([TOKEN_2]);
  });

  it("throws when the node did not answer (an allowance transport failure is not «no approval»)", async () => {
    const { client } = fakeClient({ allowances: { [key(TOKEN, CONTRACT_SPENDER)]: transport() } });
    await expect(readAllowances(CHAIN, OWNER, [{ token: TOKEN, spender: CONTRACT_SPENDER }], client)).rejects.toThrow();
  });

  it.each([
    ["-32603 RpcRequestError", internal],
    ["-32000 RpcRequestError", headerNotFound],
    ["aggregate3 answered 0x", aggregateZeroData],
    ["fallback transport error", fallbackFailed],
  ])("a whole-batch failure (%s) throws, never «every allowance reverted»", async (_name, make) => {
    const err = make();
    const { client } = fakeClient({
      allowances: { [key(TOKEN, CONTRACT_SPENDER)]: err, [key(TOKEN_2, CONTRACT_SPENDER)]: err },
      symbols: { [TOKEN.toLowerCase()]: err, [TOKEN_2.toLowerCase()]: err },
      decimals: { [TOKEN.toLowerCase()]: err, [TOKEN_2.toLowerCase()]: err },
    });
    await expect(
      readAllowances(CHAIN, OWNER, [{ token: TOKEN, spender: CONTRACT_SPENDER }, { token: TOKEN_2, spender: CONTRACT_SPENDER }], client),
    ).rejects.toThrow();
  });

  it("a non-revert failure of one allowance throws even if the others succeed", async () => {
    const { client } = fakeClient({ allowances: { [key(TOKEN, CONTRACT_SPENDER)]: internal(), [key(TOKEN_2, CONTRACT_SPENDER)]: 3n } });
    await expect(
      readAllowances(CHAIN, OWNER, [{ token: TOKEN, spender: CONTRACT_SPENDER }, { token: TOKEN_2, spender: CONTRACT_SPENDER }], client),
    ).rejects.toThrow();
  });

  it("every allowance reverting throws (it cannot be told apart from a broken read)", async () => {
    const { client } = fakeClient({ allowances: { [key(TOKEN, CONTRACT_SPENDER)]: revert(), [key(TOKEN_2, CONTRACT_SPENDER)]: revert() } });
    await expect(
      readAllowances(CHAIN, OWNER, [{ token: TOKEN, spender: CONTRACT_SPENDER }, { token: TOKEN_2, spender: CONTRACT_SPENDER }], client),
    ).rejects.toThrow();
  });

  it("reads at most MAX_PAIRS pairs and flags the rest as partial", async () => {
    expect(MAX_PAIRS).toBe(200);
    const pairs = Array.from({ length: 201 }, (_, i) => ({ token: TOKEN, spender: `0x${(i + 1).toString(16).padStart(40, "0")}` as `0x${string}` }));
    const { client, multicall } = fakeClient({});
    const r = await readAllowances(CHAIN, OWNER, pairs, client);
    expect(r.partial).toBe(true);
    const calls = (multicall.mock.calls[0]![0] as { contracts: Call[] }).contracts;
    expect(calls.filter((c) => c.functionName === "allowance")).toHaveLength(200);
  });

  it("a reverting or garbage symbol is null; bad decimals are null", async () => {
    const { client } = fakeClient({
      allowances: { [key(TOKEN, CONTRACT_SPENDER)]: 1n, [key(TOKEN_2, CONTRACT_SPENDER)]: 1n },
      symbols: { [TOKEN.toLowerCase()]: revert(), [TOKEN_2.toLowerCase()]: "‮  " },
      decimals: { [TOKEN.toLowerCase()]: revert(), [TOKEN_2.toLowerCase()]: 300 },
    });
    const r = await readAllowances(CHAIN, OWNER, [{ token: TOKEN, spender: CONTRACT_SPENDER }, { token: TOKEN_2, spender: CONTRACT_SPENDER }], client);
    expect(r.rows.map((x) => [x.symbol, x.decimals])).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it("reads symbol/decimals once per token", async () => {
    const { client, multicall } = fakeClient({});
    await readAllowances(CHAIN, OWNER, [{ token: TOKEN, spender: CONTRACT_SPENDER }, { token: TOKEN, spender: EOA_SPENDER }], client);
    const calls = (multicall.mock.calls[0]![0] as { contracts: Call[] }).contracts;
    expect(calls.filter((c) => c.functionName === "symbol")).toHaveLength(1);
    expect(calls.filter((c) => c.functionName === "decimals")).toHaveLength(1);
  });

  it("no pairs: no RPC call", async () => {
    const { client, multicall } = fakeClient({});
    expect(await readAllowances(CHAIN, OWNER, [], client)).toEqual({ rows: [], partial: false });
    expect(multicall).not.toHaveBeenCalled();
  });
});

describe("scanApprovals", () => {
  it("discovers then reads; partial from either step", async () => {
    const { client } = fakeClient({ allowances: { [key(TOKEN, PERMIT2)]: maxUint256 } });
    vi.mocked(chainClient).mockReturnValue(client);
    vi.mocked(discoverApprovalPairs).mockResolvedValue({ status: "ok", partial: true, pairs: [{ token: TOKEN, spender: PERMIT2 }] });
    const r = await scanApprovals(CHAIN, OWNER);
    expect(r).toMatchObject({ status: "ok", partial: true, rows: [{ token: TOKEN, spender: PERMIT2, spenderKind: "known", unlimited: true }] });
    expect(discoverApprovalPairs).toHaveBeenCalledWith(CHAIN, OWNER);
  });

  it("passes an unavailable discovery through", async () => {
    vi.mocked(discoverApprovalPairs).mockResolvedValue({ status: "unavailable", reason: "blocked" });
    expect(await scanApprovals(CHAIN, OWNER)).toEqual({ status: "unavailable", reason: "blocked" });
  });

  it("an RPC failure while reading is unavailable, never an empty list", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient({ allowances: { [key(TOKEN, PERMIT2)]: transport() } });
    vi.mocked(chainClient).mockReturnValue(client);
    vi.mocked(discoverApprovalPairs).mockResolvedValue({ status: "ok", partial: false, pairs: [{ token: TOKEN, spender: PERMIT2 }] });
    expect(await scanApprovals(CHAIN, OWNER)).toEqual({ status: "unavailable", reason: "error" });
  });

  it.each([
    ["timeout", rpcTimeout],
    ["rate_limited", rpc429],
    ["error", internal],
  ] as const)("maps an RPC failure to unavailable/%s", async (reason, make) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = make();
    const { client } = fakeClient({ allowances: { [key(TOKEN, PERMIT2)]: err }, symbols: { [TOKEN.toLowerCase()]: err }, decimals: { [TOKEN.toLowerCase()]: err } });
    vi.mocked(chainClient).mockReturnValue(client);
    vi.mocked(discoverApprovalPairs).mockResolvedValue({ status: "ok", partial: false, pairs: [{ token: TOKEN, spender: PERMIT2 }] });
    expect(await scanApprovals(CHAIN, OWNER)).toEqual({ status: "unavailable", reason });
  });

  it("an invalid owner is invalid_input, without any read", async () => {
    expect(await scanApprovals(CHAIN, "0xnope" as `0x${string}`)).toEqual({ status: "unavailable", reason: "invalid_input" });
    expect(discoverApprovalPairs).not.toHaveBeenCalled();
    expect(chainClient).not.toHaveBeenCalled();
  });
});

describe("checkAllowance (manual check)", () => {
  it("an address without code is not_a_token", async () => {
    const { client, multicall } = fakeClient({ code: { [TOKEN.toLowerCase()]: "0x" } });
    expect(await checkAllowance(CHAIN, OWNER, TOKEN, CONTRACT_SPENDER, client)).toEqual({ error: "not_a_token" });
    expect(multicall).not.toHaveBeenCalled();
  });

  it("a contract whose allowance reverts is not_a_token", async () => {
    const { client } = fakeClient({ allowances: { [key(TOKEN, CONTRACT_SPENDER)]: revert() } });
    expect(await checkAllowance(CHAIN, OWNER, TOKEN, CONTRACT_SPENDER, client)).toEqual({ error: "not_a_token" });
  });

  it("an RPC failure is rpc_unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient({ code: { [TOKEN.toLowerCase()]: transport() } });
    expect(await checkAllowance(CHAIN, OWNER, TOKEN, CONTRACT_SPENDER, client)).toEqual({ error: "rpc_unavailable" });
    const b = fakeClient({ allowances: { [key(TOKEN, CONTRACT_SPENDER)]: transport() } });
    expect(await checkAllowance(CHAIN, OWNER, TOKEN, CONTRACT_SPENDER, b.client)).toEqual({ error: "rpc_unavailable" });
  });

  it.each([
    ["-32603 RpcRequestError", internal],
    ["-32000 RpcRequestError", headerNotFound],
    ["aggregate3 answered 0x", aggregateZeroData],
    ["fallback transport error", fallbackFailed],
  ])("a batch failure (%s) is rpc_unavailable, not not_a_token", async (_name, make) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = make();
    const { client } = fakeClient({
      allowances: { [key(TOKEN, CONTRACT_SPENDER)]: err },
      symbols: { [TOKEN.toLowerCase()]: err },
      decimals: { [TOKEN.toLowerCase()]: err },
    });
    expect(await checkAllowance(CHAIN, OWNER, TOKEN, CONTRACT_SPENDER, client)).toEqual({ error: "rpc_unavailable" });
  });

  it("an invalid owner, token or spender is invalid_input, without any read", async () => {
    const { client, getCode, multicall } = fakeClient({});
    expect(await checkAllowance(CHAIN, OWNER, "0x12" as `0x${string}`, CONTRACT_SPENDER, client)).toEqual({ error: "invalid_input" });
    expect(await checkAllowance(CHAIN, OWNER, TOKEN, "spender" as `0x${string}`, client)).toEqual({ error: "invalid_input" });
    expect(await checkAllowance(CHAIN, "0x" as `0x${string}`, TOKEN, CONTRACT_SPENDER, client)).toEqual({ error: "invalid_input" });
    expect(getCode).not.toHaveBeenCalled();
    expect(multicall).not.toHaveBeenCalled();
  });

  it("a zero allowance is { allowance: '0' }", async () => {
    const { client } = fakeClient({});
    expect(await checkAllowance(CHAIN, OWNER, TOKEN, CONTRACT_SPENDER, client)).toEqual({ allowance: "0" });
  });

  it("a live allowance is a full row (lower-case input is checksummed)", async () => {
    const { client } = fakeClient({ allowances: { [key(TOKEN, EOA_SPENDER)]: 7n }, code: { [EOA_SPENDER.toLowerCase()]: "0x" } });
    const r = await checkAllowance(CHAIN, OWNER, TOKEN.toLowerCase() as `0x${string}`, EOA_SPENDER, client);
    expect(r).toEqual({
      token: TOKEN,
      symbol: "USDC",
      decimals: 6,
      spender: EOA_SPENDER,
      spenderLabel: null,
      spenderKind: "eoa",
      allowance: "7",
      unlimited: false,
    });
  });

  it("defaults to the chain's client", async () => {
    const { client } = fakeClient({});
    vi.mocked(chainClient).mockReturnValue(client);
    await checkAllowance(CHAIN, OWNER, TOKEN, CONTRACT_SPENDER);
    expect(chainClient).toHaveBeenCalledWith(CHAIN);
  });
});
