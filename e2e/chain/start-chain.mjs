// Starts the local Hardhat nodes used by the on-chain E2E (Playwright webServer), one per network of the testnet set
// (CHAINS in shared.mjs: Base Sepolia 84532 on :8545, Arbitrum Sepolia 421614 on :8546), then prepares each:
//   1. eth_chainId must be that network's id (hardhat.config.cjs reads it from E2E_CHAIN_ID);
//   2. hardhat_setCode puts the mock USDC runtime bytecode at Circle's USDC address for that testnet;
//   3. the first MINTED_ACCOUNTS Hardhat accounts get MINT_PER_ACCOUNT mock USDC;
//   4. (P1) the club Safe address gets code (runtime `0x00`: STOP, so it accepts plain ETH), so verifyClubSafe sees it
//      deployed on both networks;
//   5. (P1) the mock Chainlink ETH/USD aggregator goes to ETH_USD_FEED (playwright.config.ts points
//      ETH_USD_FEED_ADDRESS_<chainId> there) with an answer of 2000 USD, stamped with the block time.
// Once both are ready, a tiny HTTP server on READY_PORT answers 200 (Playwright waits for it, not for the RPC ports).
// The mock WETH JSON (F4a) stays in this folder; no active spec uses it.
// Plain Node, no shell syntax: works from PowerShell, cmd and bash.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData } from "viem";
import { CHAINS, CLUB_SAFE, ETH_USD_FEED, ETH_USD_PRICE_E8, hardhatAccount, MINT_PER_ACCOUNT, MINTED_ACCOUNTS, READY_PORT } from "./shared.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const mock = JSON.parse(readFileSync(join(here, "mock-usdc.json"), "utf8"));
const aggregator = JSON.parse(readFileSync(join(here, "mock-aggregator.json"), "utf8"));
const hardhatBin = join(dirname(require.resolve("hardhat/package.json")), "internal", "cli", "bootstrap.js");

async function rpc(url, method, params = []) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

const nodes = [];
let readyServer;
let stopping = false;
function shutdown(code = 0) {
  stopping = true;
  readyServer?.close();
  for (const n of nodes) n.kill();
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function startNode(chainId, port) {
  const node = spawn(
    process.execPath,
    [hardhatBin, "--config", join(here, "hardhat.config.cjs"), "node", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: here,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, HARDHAT_DISABLE_TELEMETRY_PROMPT: "true", E2E_CHAIN_ID: String(chainId) },
    },
  );
  node.on("exit", (code) => {
    if (stopping) return;
    console.error(`[chain] hardhat node ${chainId} exited (${code})`);
    shutdown(code ?? 1);
  });
  nodes.push(node);
}

async function waitForRpc(url) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      return await rpc(url, "eth_chainId");
    } catch {
      if (Date.now() > deadline) throw new Error(`hardhat node on ${url} did not start in 60 s`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

async function prepare(chainId) {
  const { rpcUrl, usdc } = CHAINS[chainId];
  const actual = Number.parseInt(await waitForRpc(rpcUrl), 16);
  if (actual !== chainId) throw new Error(`unexpected chainId ${actual} on ${rpcUrl} (want ${chainId})`);

  await rpc(rpcUrl, "hardhat_setCode", [usdc, mock.runtimeBytecode]);
  const deployer = hardhatAccount(0).address;
  for (let i = 0; i < MINTED_ACCOUNTS; i++) {
    const data = encodeFunctionData({ abi: mock.abi, functionName: "mint", args: [hardhatAccount(i).address, MINT_PER_ACCOUNT] });
    await rpc(rpcUrl, "eth_sendTransaction", [{ from: deployer, to: usdc, data }]);
  }
  const code = await rpc(rpcUrl, "eth_getCode", [usdc, "latest"]);
  if (code.toLowerCase() !== mock.runtimeBytecode.toLowerCase()) throw new Error(`mock USDC code mismatch on ${chainId} after hardhat_setCode`);

  // The club Safe "exists" (getCode != 0x) and accepts ETH: a one-byte STOP runtime is enough for the e2e.
  await rpc(rpcUrl, "hardhat_setCode", [CLUB_SAFE, "0x00"]);
  if ((await rpc(rpcUrl, "eth_getCode", [CLUB_SAFE, "latest"])).toLowerCase() !== "0x00") throw new Error(`Safe code missing on ${chainId}`);

  // ETH/USD feed at a fixed address, answer 2000 USD (8 decimals).
  await rpc(rpcUrl, "hardhat_setCode", [ETH_USD_FEED, aggregator.runtimeBytecode]);
  const setAnswer = encodeFunctionData({ abi: aggregator.abi, functionName: "setAnswer", args: [ETH_USD_PRICE_E8] });
  await rpc(rpcUrl, "eth_sendTransaction", [{ from: deployer, to: ETH_USD_FEED, data: setAnswer }]);
  console.log(`[chain] chain ${chainId} on ${rpcUrl}, mock USDC at ${usdc}, Safe code at ${CLUB_SAFE}, ETH/USD feed at ${ETH_USD_FEED}`);
}

async function main() {
  // One node at a time: both share hardhat.config.cjs and its cache folder.
  for (const [id, { rpcPort }] of Object.entries(CHAINS)) {
    startNode(Number(id), rpcPort);
    await prepare(Number(id));
  }
  readyServer = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ready");
  });
  readyServer.listen(READY_PORT, "127.0.0.1", () => console.log(`[chain] ready: ${Object.keys(CHAINS).join(", ")}`));
}

main().catch((e) => {
  console.error("[chain] setup failed:", e);
  shutdown(1);
});
