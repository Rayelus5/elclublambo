// @vitest-environment node
// The e2e Blockscout mock answers getLogs by forwarding eth_getLogs to the local node (P6 plan, mock of Task 2/3).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAINS } from "../../../e2e/chain/shared.mjs";
import { handle } from "../../../e2e/mock/checker.mjs";

const T0 = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
const T1 = `0x${"0".repeat(24)}f39fd6e51aad88f6f4ce6ab8827279cfffb92266`;
const T2 = `0x${"0".repeat(24)}${"11".repeat(20)}`;
const QUERY = `module=logs&action=getLogs&fromBlock=0&toBlock=latest&topic0=${T0}&topic1=${T1}&topic0_1_opr=and`;

type Reply = { status: number; headers: Record<string, string>; body: string };

function call(method: string, url: string): Promise<Reply> {
  return new Promise((resolve) => {
    const out: Reply = { status: 0, headers: {}, body: "" };
    const res = {
      writeHead(status: number, headers: Record<string, string> = {}) {
        out.status = status;
        out.headers = headers;
      },
      end(body = "") {
        out.body = body;
        resolve(out);
      },
    };
    void handle({ method, url } as never, res as never);
  });
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => {
  await call("POST", "/__logs/ok");
  vi.unstubAllGlobals();
});

describe("mock Blockscout getLogs", () => {
  it("forwards eth_getLogs to the chain's node and answers in Blockscout's format", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: [{ address: "0xabc", topics: [T0, T1, T2], data: "0x01", blockNumber: "0x5", transactionHash: "0xdef", logIndex: "0x0" }],
        }),
      ),
    );
    const r = await call("GET", `/blockscout/421614/api?${QUERY}`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(CHAINS[421614].rpcUrl);
    const body = JSON.parse(String(init.body));
    expect(body.method).toBe("eth_getLogs");
    expect(body.params).toEqual([{ fromBlock: "0x0", toBlock: "latest", topics: [T0, T1] }]);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({
      status: "1",
      message: "OK",
      result: [{ address: "0xabc", topics: [T0, T1, T2, null], data: "0x01", blockNumber: "0x5", transactionHash: "0xdef", logIndex: "0x0" }],
    });
  });

  it("no logs → status 0 «No logs found»", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: [] })));
    const r = await call("GET", `/blockscout/84532/api?${QUERY}`);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(CHAINS[84532].rpcUrl);
    expect(JSON.parse(r.body)).toEqual({ status: "0", message: "No logs found", result: [] });
  });

  it("POST /__logs/fail switches getLogs to a 403 challenge until /__logs/ok", async () => {
    expect((await call("POST", "/__logs/fail")).status).toBe(200);
    const blocked = await call("GET", `/blockscout/84532/api?${QUERY}`);
    expect(blocked.status).toBe(403);
    expect(blocked.headers["cf-mitigated"]).toBe("challenge");
    expect(fetchMock).not.toHaveBeenCalled();
    await call("POST", "/__logs/ok");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: [] })));
    expect((await call("GET", `/blockscout/84532/api?${QUERY}`)).status).toBe(200);
  });

  it("a node error is a 502", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    expect((await call("GET", `/blockscout/84532/api?${QUERY}`)).status).toBe(502);
  });

  it("leaves the rest of the mock alone", async () => {
    expect((await call("GET", "/__health")).status).toBe(200);
    expect((await call("GET", "/blockscout/84532/api/v2/transactions/0x1")).status).toBe(403);
    expect((await call("POST", "/blockscout/84532/api/v2/addresses/0x1")).status).toBe(405);
    expect((await call("GET", "/blockscout/1/api?module=logs&action=getLogs")).status).toBe(404);
  });
});
