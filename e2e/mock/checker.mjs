// TEST-ONLY local mock of the checker's keyless sources (src/lib/checker/token/sources.ts, P4-R1), so the P4 e2e never
// touches Blockscout, Sourcify or DexScreener. Plain Node HTTP, no dependencies, deterministic fixtures.
// The app reaches it through CHECKER_BLOCKSCOUT_BASE_<chainId> and CHECKER_SOURCIFY_BASE (playwright.config.ts; honoured
// on the testnet set only, ruling R-A). DexScreener is never asked on testnets (the market section is «no disponible»).
//   GET /blockscout/84532/api/v2/addresses/{usdc}         verified contract with a creator and a creation tx
//   GET /blockscout/84532/api/v2/smart-contracts/{usdc}   its ABI (has `mint`: the abi_privileged notice)
//   GET /blockscout/84532/api/v2/transactions/{tx}        403 Cloudflare challenge → the age is «Desconocido»
//   GET /sourcify/v2/contract/...                         404 (not verified there)
//   GET /blockscout/{84532|421614}/api?module=logs&action=getLogs&topic0=…&topic1=…   the approvals page (P6-R2): the
//                                                         node's own eth_getLogs (block 0 → latest, [topic0, topic1]) in
//                                                         Blockscout's RPC format (four topic slots, null-padded)
//   POST /__logs/fail, POST /__logs/ok                    getLogs answers a 403 Cloudflare challenge until /__logs/ok
//   anything else                                         404
//   GET /__health                                         readiness (Playwright webServer url)
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { CHAINS } from "../chain/shared.mjs";

export const MOCK_CHECKER_PORT = 8552;
export const MOCK_CHECKER_BASE = `http://127.0.0.1:${MOCK_CHECKER_PORT}`;

const USDC = CHAINS[84532].usdc.toLowerCase();
/** TEST-ONLY: Hardhat account 0, shown as the contract's creator. */
export const MOCK_CREATOR = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const CREATION_TX = `0x${"ab".repeat(32)}`;

const ABI = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
];

/** What Cloudflare answers a bot it challenges (the shape the real Blockscout mainnet hosts send from some IPs). */
const CHALLENGE = "<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><div id=\"challenge-platform\"></div></body></html>";

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function challenge(res) {
  res.writeHead(403, { "content-type": "text/html; charset=UTF-8", "cf-mitigated": "challenge" });
  return res.end(CHALLENGE);
}

/** Toggled by POST /__logs/fail and /__logs/ok: Review Focus 1 (the list cannot be fetched). */
let logsBlocked = false;

/** Blockscout's getLogs (logs_view.ex) from the local node's eth_getLogs. */
async function getLogs(res, chainId, query) {
  if (logsBlocked) return challenge(res);
  const topic0 = query.get("topic0");
  const topic1 = query.get("topic1");
  if (!topic0 || !topic1) return json(res, 200, { status: "0", message: "Required query parameters missing: topic0, topic1", result: null });
  let logs;
  try {
    const r = await fetch(CHAINS[chainId].rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [{ fromBlock: "0x0", toBlock: "latest", topics: [topic0, topic1] }] }),
    });
    logs = (await r.json()).result;
    if (!Array.isArray(logs)) throw new Error("no result");
  } catch {
    return json(res, 502, { message: "node unavailable" });
  }
  if (logs.length === 0) return json(res, 200, { status: "0", message: "No logs found", result: [] });
  const result = logs.map((l) => ({
    address: l.address,
    topics: [0, 1, 2, 3].map((i) => l.topics[i] ?? null),
    data: l.data,
    blockNumber: l.blockNumber,
    transactionHash: l.transactionHash,
    logIndex: l.logIndex,
  }));
  return json(res, 200, { status: "1", message: "OK", result });
}

export function handle(req, res) {
  const url = new URL(req.url ?? "/", MOCK_CHECKER_BASE);
  const path = url.pathname.toLowerCase();
  if (path === "/__health") return json(res, 200, { ok: true });
  if (req.method === "POST" && (path === "/__logs/fail" || path === "/__logs/ok")) {
    logsBlocked = path === "/__logs/fail";
    return json(res, 200, { blocked: logsBlocked });
  }
  if (req.method !== "GET") return json(res, 405, { message: "method not allowed" });

  const logsRoute = /^\/blockscout\/(84532|421614)\/api$/.exec(path);
  if (logsRoute && url.searchParams.get("module") === "logs" && url.searchParams.get("action") === "getLogs") {
    return getLogs(res, Number(logsRoute[1]), url.searchParams);
  }

  if (path === `/blockscout/84532/api/v2/addresses/${USDC}`) {
    return json(res, 200, {
      hash: USDC,
      is_contract: true,
      is_verified: true,
      is_scam: false,
      creator_address_hash: MOCK_CREATOR,
      creation_transaction_hash: CREATION_TX,
      implementations: [],
    });
  }
  if (path === `/blockscout/84532/api/v2/smart-contracts/${USDC}`) return json(res, 200, { abi: ABI });
  if (path.startsWith("/blockscout/84532/api/v2/transactions/")) return challenge(res);
  return json(res, 404, { message: "Not found" });
}

// Started directly (`node e2e/mock/checker.mjs`): listen. Imported: only the constants and the handler are used.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createServer(handle).listen(MOCK_CHECKER_PORT, "127.0.0.1", () => console.log(`mock checker sources on ${MOCK_CHECKER_BASE}`));
}
