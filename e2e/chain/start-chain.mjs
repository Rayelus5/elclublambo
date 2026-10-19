// Starts the local Hardhat node used by the on-chain E2E (Playwright webServer), then prepares it:
//   1. hardhat_setCode puts the mock USDC runtime bytecode at Circle's Linea Sepolia USDC address;
//   2. the first MINTED_ACCOUNTS Hardhat accounts get MINT_PER_ACCOUNT mock USDC;
//   2b. F4a: the mock Chainlink ETH/USD feed (answer 2500e8) and the mock WETH go to their fixed test addresses;
//   3. a tiny HTTP server on READY_PORT answers 200 (Playwright waits for it, not for the RPC port).
// Plain Node, no shell syntax: works from PowerShell, cmd and bash.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData } from "viem";
import {
  CHAIN_ID,
  ETH_USD_FEED_ADDRESS,
  hardhatAccount,
  INITIAL_ETH_PRICE_E8,
  MINT_PER_ACCOUNT,
  MINTED_ACCOUNTS,
  READY_PORT,
  RPC_PORT,
  RPC_URL,
  USDC_ADDRESS,
  WETH_ADDRESS,
} from "./shared.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const mock = JSON.parse(readFileSync(join(here, "mock-usdc.json"), "utf8"));
const aggregator = JSON.parse(readFileSync(join(here, "mock-aggregator.json"), "utf8"));
const weth = JSON.parse(readFileSync(join(here, "mock-weth.json"), "utf8"));

async function rpc(method, params = []) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

const hardhatBin = join(dirname(require.resolve("hardhat/package.json")), "internal", "cli", "bootstrap.js");
const node = spawn(
  process.execPath,
  [hardhatBin, "--config", join(here, "hardhat.config.cjs"), "node", "--hostname", "127.0.0.1", "--port", String(RPC_PORT)],
  { cwd: here, stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, HARDHAT_DISABLE_TELEMETRY_PROMPT: "true" } },
);
node.on("exit", (code) => {
  console.error(`[chain] hardhat node exited (${code})`);
  process.exit(code ?? 1);
});

let readyServer;
function shutdown() {
  readyServer?.close();
  node.kill();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function waitForRpc() {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      return await rpc("eth_chainId");
    } catch {
      if (Date.now() > deadline) throw new Error("hardhat node did not start in 60 s");
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

async function prepare() {
  const chainId = Number.parseInt(await waitForRpc(), 16);
  if (chainId !== CHAIN_ID) throw new Error(`unexpected chainId ${chainId}`);

  await rpc("hardhat_setCode", [USDC_ADDRESS, mock.runtimeBytecode]);
  const deployer = hardhatAccount(0).address;
  for (let i = 0; i < MINTED_ACCOUNTS; i++) {
    const data = encodeFunctionData({ abi: mock.abi, functionName: "mint", args: [hardhatAccount(i).address, MINT_PER_ACCOUNT] });
    await rpc("eth_sendTransaction", [{ from: deployer, to: USDC_ADDRESS, data }]);
  }
  const code = await rpc("eth_getCode", [USDC_ADDRESS, "latest"]);
  if (code.toLowerCase() !== mock.runtimeBytecode.toLowerCase()) throw new Error("mock USDC code mismatch after hardhat_setCode");

  // F4a: the mock ETH/USD feed (price 2500 USD) and the mock WETH at their fixed test addresses.
  await rpc("hardhat_setCode", [ETH_USD_FEED_ADDRESS, aggregator.runtimeBytecode]);
  await rpc("hardhat_setCode", [WETH_ADDRESS, weth.runtimeBytecode]);
  const setAnswer = encodeFunctionData({ abi: aggregator.abi, functionName: "setAnswer", args: [INITIAL_ETH_PRICE_E8] });
  await rpc("eth_sendTransaction", [{ from: deployer, to: ETH_USD_FEED_ADDRESS, data: setAnswer }]);
  for (const [address, json, name] of [
    [ETH_USD_FEED_ADDRESS, aggregator, "feed"],
    [WETH_ADDRESS, weth, "WETH"],
  ]) {
    const c = await rpc("eth_getCode", [address, "latest"]);
    if (c.toLowerCase() !== json.runtimeBytecode.toLowerCase()) throw new Error(`mock ${name} code mismatch after hardhat_setCode`);
  }

  readyServer = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ready");
  });
  readyServer.listen(READY_PORT, "127.0.0.1", () => console.log(`[chain] ready: chain ${CHAIN_ID} on ${RPC_URL}, mock USDC at ${USDC_ADDRESS}, feed ${ETH_USD_FEED_ADDRESS}, WETH ${WETH_ADDRESS}`));
}

prepare().catch((e) => {
  console.error("[chain] setup failed:", e);
  node.kill();
  process.exit(1);
});
