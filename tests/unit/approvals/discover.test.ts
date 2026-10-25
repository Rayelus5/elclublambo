// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { APPROVAL_TOPIC, BLOCKSCOUT_LOG_CAP, discoverApprovalPairs } from "@/lib/approvals/discover";

const OWNER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;
const OWNER_TOPIC = `0x${"0".repeat(24)}f39fd6e51aad88f6f4ce6ab8827279cfffb92266`;
const TOKEN_A = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const TOKEN_B = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
const SPENDER_1 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const SPENDER_2 = "0x6fF5693b99212Da76ad316178A184AB56D299b43";
const pad = (a: string) => `0x${"0".repeat(24)}${a.slice(2).toLowerCase()}`;
const TESTNET = { NEXT_PUBLIC_NETWORK_SET: "testnet" };

/** A Blockscout getLogs entry: topics always come as four slots, null-padded (logs_view.ex). */
function log(token: string, spender: string, block: number, logIndex = 0, extraTopic: string | null = null) {
  return {
    address: token.toLowerCase(),
    topics: [APPROVAL_TOPIC, OWNER_TOPIC, pad(spender), extraTopic],
    data: `0x${"f".repeat(64)}`,
    blockNumber: `0x${block.toString(16)}`,
    logIndex: `0x${logIndex.toString(16)}`,
    transactionHash: `0x${"ab".repeat(32)}`,
  };
}

const fetchMock = vi.fn();
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("APPROVAL_TOPIC / BLOCKSCOUT_LOG_CAP", () => {
  it("is the ERC-20 Approval event signature and the API's cap", () => {
    expect(APPROVAL_TOPIC).toBe("0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925");
    expect(BLOCKSCOUT_LOG_CAP).toBe(1000);
  });
});

describe("discoverApprovalPairs (P6-R2, Review Focus 1)", () => {
  it("asks Blockscout's RPC getLogs with the Approval topic and the owner as topic1", async () => {
    fetchMock.mockResolvedValue(ok({ status: "0", message: "No logs found", result: [] }));
    await discoverApprovalPairs(8453, OWNER, {});
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.origin).toBe("https://base.blockscout.com");
    expect(url.pathname).toBe("/api");
    const q = url.searchParams;
    expect(q.get("module")).toBe("logs");
    expect(q.get("action")).toBe("getLogs");
    expect(q.get("fromBlock")).toBe("0");
    expect(q.get("toBlock")).toBe("latest");
    expect(q.get("topic0")).toBe(APPROVAL_TOPIC);
    expect(q.get("topic1")).toBe(OWNER_TOPIC);
    expect(q.get("topic0_1_opr")).toBe("and");
    expect(q.has("address")).toBe(false);
  });

  it("uses the testnet override on the testnet set", async () => {
    fetchMock.mockResolvedValue(ok({ status: "0", message: "No logs found", result: [] }));
    await discoverApprovalPairs(84532, OWNER, { ...TESTNET, CHECKER_BLOCKSCOUT_BASE_84532: "http://127.0.0.1:8552/blockscout/84532" });
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/^http:\/\/127\.0\.0\.1:8552\/blockscout\/84532\/api\?/);
  });

  it("ignores CHECKER_BLOCKSCOUT_BASE_8453 on the mainnet set", async () => {
    fetchMock.mockResolvedValue(ok({ status: "0", message: "No logs found", result: [] }));
    await discoverApprovalPairs(8453, OWNER, { NEXT_PUBLIC_NETWORK_SET: "mainnet", CHECKER_BLOCKSCOUT_BASE_8453: "https://evil.example" });
    expect(new URL(String(fetchMock.mock.calls[0]![0])).origin).toBe("https://base.blockscout.com");
  });

  it("returns unique (token, spender) pairs, newest block first, checksummed", async () => {
    fetchMock.mockResolvedValue(
      ok({
        status: "1",
        message: "OK",
        result: [log(TOKEN_A, SPENDER_1, 10), log(TOKEN_B, SPENDER_2, 30), log(TOKEN_A, SPENDER_1, 20), log(TOKEN_A, SPENDER_2, 20, 3)],
      }),
    );
    const r = await discoverApprovalPairs(8453, OWNER, {});
    expect(r).toEqual({
      status: "ok",
      partial: false,
      pairs: [
        { token: TOKEN_B, spender: SPENDER_2 },
        { token: TOKEN_A, spender: SPENDER_2 },
        { token: TOKEN_A, spender: SPENDER_1 },
      ],
    });
  });

  it("ignores a 4-topic Approval (ERC-721) and logs that are not the owner's Approval", async () => {
    const nft = log(TOKEN_B, SPENDER_2, 50, 0, pad("0x0000000000000000000000000000000000000007"));
    const otherOwner = { ...log(TOKEN_B, SPENDER_1, 40), topics: [APPROVAL_TOPIC, pad(SPENDER_2), pad(SPENDER_1), null] };
    const notApproval = { ...log(TOKEN_B, SPENDER_1, 40), topics: [`0x${"1".repeat(64)}`, OWNER_TOPIC, pad(SPENDER_1), null] };
    const unpadded = { ...log(TOKEN_A, SPENDER_2, 5), topics: [APPROVAL_TOPIC, OWNER_TOPIC, pad(SPENDER_2)] };
    fetchMock.mockResolvedValue(ok({ status: "1", message: "OK", result: [nft, otherOwner, notApproval, log(TOKEN_A, SPENDER_1, 1), unpadded, "junk"] }));
    const r = await discoverApprovalPairs(8453, OWNER, {});
    expect(r).toEqual({
      status: "ok",
      partial: false,
      pairs: [
        { token: TOKEN_A, spender: SPENDER_2 },
        { token: TOKEN_A, spender: SPENDER_1 },
      ],
    });
  });

  it("«No logs found» is an empty ok list", async () => {
    fetchMock.mockResolvedValue(ok({ status: "0", message: "No logs found", result: [] }));
    expect(await discoverApprovalPairs(8453, OWNER, {})).toEqual({ status: "ok", pairs: [], partial: false });
  });

  it("any other status 0 is unavailable/error, never «no approvals»", async () => {
    fetchMock.mockResolvedValue(ok({ status: "0", message: "Required query parameters missing: toBlock", result: null }));
    expect(await discoverApprovalPairs(8453, OWNER, {})).toEqual({ status: "unavailable", reason: "error" });
  });

  it("a malformed body is unavailable/error", async () => {
    fetchMock.mockResolvedValue(ok({ status: "1", message: "OK", result: "nope" }));
    expect(await discoverApprovalPairs(8453, OWNER, {})).toEqual({ status: "unavailable", reason: "error" });
  });

  it("a 403 Cloudflare challenge is unavailable/blocked", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html><title>Just a moment...</title></html>", { status: 403, headers: { "content-type": "text/html", "cf-mitigated": "challenge" } }),
    );
    expect(await discoverApprovalPairs(8453, OWNER, {})).toEqual({ status: "unavailable", reason: "blocked" });
  });

  it("a timeout is unavailable/timeout", async () => {
    fetchMock.mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    expect(await discoverApprovalPairs(8453, OWNER, {})).toEqual({ status: "unavailable", reason: "timeout" });
  });

  it("a 429 is unavailable/rate_limited and a 404 is unavailable/error", async () => {
    fetchMock.mockResolvedValueOnce(new Response("slow down", { status: 429 }));
    expect(await discoverApprovalPairs(8453, OWNER, {})).toEqual({ status: "unavailable", reason: "rate_limited" });
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 404 }));
    expect(await discoverApprovalPairs(8453, OWNER, {})).toEqual({ status: "unavailable", reason: "error" });
  });

  it("1 000 results (the API's cap) is a partial list", async () => {
    const result = Array.from({ length: 1000 }, (_, i) => log(TOKEN_A, SPENDER_1, 1000 - i));
    fetchMock.mockResolvedValue(ok({ status: "1", message: "OK", result }));
    const r = await discoverApprovalPairs(8453, OWNER, {});
    expect(r).toEqual({ status: "ok", partial: true, pairs: [{ token: TOKEN_A, spender: SPENDER_1 }] });
  });

  it("never throws", async () => {
    fetchMock.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(await discoverApprovalPairs(8453, OWNER, {})).toEqual({ status: "unavailable", reason: "error" });
  });
});
