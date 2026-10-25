// Starts the local Hardhat nodes used by the on-chain E2E (Playwright webServer), one per network of the testnet set
// (CHAINS in shared.mjs: Base Sepolia 84532 on :8545, Arbitrum Sepolia 421614 on :8546), then prepares each:
//   1. eth_chainId must be that network's id (hardhat.config.cjs reads it from E2E_CHAIN_ID);
//   2. hardhat_setCode puts the mock USDC runtime bytecode at Circle's USDC address for that testnet;
//   3. the first MINTED_ACCOUNTS Hardhat accounts get MINT_PER_ACCOUNT mock USDC;
//   4. (P1) the club Safe address gets code (runtime `0x00`: STOP, so it accepts plain ETH), so verifyClubSafe sees it
//      deployed on both networks;
//   5. (P1) the mock Chainlink ETH/USD aggregator goes to ETH_USD_FEED (playwright.config.ts points
//      ETH_USD_FEED_ADDRESS_<chainId> there) with an answer of 2000 USD, stamped with the block time;
//   6. (P4) Multicall3 at its canonical address;
//   7. (P5, 84532 only) EAS (P5-R9): SchemaRegistry and EAS from @ethereum-attestation-service/eas-contracts 1.9.0 are
//      deployed normally, then their runtime code is copied with hardhat_setCode to the OP Stack predeploys
//      SCHEMA_REGISTRY_ADDRESS (0x…20) and EAS_ADDRESS (0x…21), the addresses the app uses on Base. This is sound:
//      SchemaRegistry has no immutables but Semver constants and starts with empty storage; EAS gets 0x…20 in its
//      constructor (so its immutable registry already points at the predeploy), its constructor writes no storage, and
//      OpenZeppelin's EIP712 recomputes the domain separator when address(this) differs from the deploy address. Then
//      VOUCH_SCHEMA is registered (no resolver, revocable) and the start aborts unless getSchemaRegistry() = 0x…20,
//      version() = 1.4.0 and getSchema(uid).uid = uid.
// Once both are ready, a tiny HTTP server on READY_PORT answers 200 (Playwright waits for it, not for the RPC ports).
// The mock WETH JSON (F4a) stays in this folder; no active spec uses it.
// Plain Node, no shell syntax: works from PowerShell, cmd and bash.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decodeFunctionResult, encodeDeployData, encodeFunctionData, encodePacked, keccak256, zeroAddress } from "viem";
import {
  CHAINS,
  CLUB_SAFE,
  EAS_ADDRESS,
  ETH_USD_FEED,
  ETH_USD_PRICE_E8,
  hardhatAccount,
  MINT_PER_ACCOUNT,
  MINTED_ACCOUNTS,
  READY_PORT,
  SCHEMA_REGISTRY_ADDRESS,
  VOUCH_SCHEMA,
} from "./shared.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const mock = JSON.parse(readFileSync(join(here, "mock-usdc.json"), "utf8"));
const aggregator = JSON.parse(readFileSync(join(here, "mock-aggregator.json"), "utf8"));
// TEST-ONLY: EAS artifacts (P5-R9), pinned by the exact devDependency version.
const easArtifacts = "@ethereum-attestation-service/eas-contracts/artifacts/contracts";
const registryArtifact = require(`${easArtifacts}/SchemaRegistry.sol/SchemaRegistry.json`);
const easArtifact = require(`${easArtifacts}/EAS.sol/EAS.json`);
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

/** Multicall3's canonical address (viem's chain definitions point every testnet here). */
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
// Not in viem's public exports: imported by file URL from its package folder (TEST-ONLY setup).
const viemDir = dirname(require.resolve("viem/package.json"));
const { multicall3Bytecode } = await import(pathToFileURL(join(viemDir, "_esm", "constants", "contracts.js")).href);

/** Deploys `data` (creation code) from `from` and returns the runtime code it left behind. */
async function deployedRuntime(rpcUrl, from, data) {
  const tx = await rpc(rpcUrl, "eth_sendTransaction", [{ from, data }]);
  const { contractAddress, status } = await rpc(rpcUrl, "eth_getTransactionReceipt", [tx]);
  if (status !== "0x1" || !contractAddress) throw new Error("deployment failed");
  return rpc(rpcUrl, "eth_getCode", [contractAddress, "latest"]);
}

async function call(rpcUrl, to, abi, functionName, args = []) {
  const data = encodeFunctionData({ abi, functionName, args });
  return decodeFunctionResult({ abi, functionName, data: await rpc(rpcUrl, "eth_call", [{ to, data }, "latest"]) });
}

/** Step 7: EAS at the Base predeploys with the vouch schema registered (P5-R9). Throws, aborting the start, if anything is off. */
async function prepareEas(rpcUrl) {
  const deployer = hardhatAccount(0).address;
  await rpc(rpcUrl, "hardhat_setCode", [SCHEMA_REGISTRY_ADDRESS, await deployedRuntime(rpcUrl, deployer, registryArtifact.bytecode)]);
  const easDeploy = encodeDeployData({ abi: easArtifact.abi, bytecode: easArtifact.bytecode, args: [SCHEMA_REGISTRY_ADDRESS] });
  await rpc(rpcUrl, "hardhat_setCode", [EAS_ADDRESS, await deployedRuntime(rpcUrl, deployer, easDeploy)]);

  const register = encodeFunctionData({ abi: registryArtifact.abi, functionName: "register", args: [VOUCH_SCHEMA, zeroAddress, true] });
  const regTx = await rpc(rpcUrl, "eth_sendTransaction", [{ from: deployer, to: SCHEMA_REGISTRY_ADDRESS, data: register }]);
  if ((await rpc(rpcUrl, "eth_getTransactionReceipt", [regTx])).status !== "0x1") throw new Error("EAS schema registration reverted");

  const uid = keccak256(encodePacked(["string", "address", "bool"], [VOUCH_SCHEMA, zeroAddress, true]));
  const registry = await call(rpcUrl, EAS_ADDRESS, easArtifact.abi, "getSchemaRegistry");
  if (registry.toLowerCase() !== SCHEMA_REGISTRY_ADDRESS.toLowerCase()) throw new Error(`EAS points at registry ${registry}`);
  const version = await call(rpcUrl, EAS_ADDRESS, easArtifact.abi, "version");
  if (version !== "1.4.0") throw new Error(`unexpected EAS version ${version}`);
  const schema = await call(rpcUrl, SCHEMA_REGISTRY_ADDRESS, registryArtifact.abi, "getSchema", [uid]);
  if (schema.uid !== uid) throw new Error(`vouch schema ${uid} not registered`);
  return uid;
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
  // P4: Multicall3 at its canonical address, as on every real chain (viem's client.multicall, used by the token checker,
  // targets it). viem ships Multicall3's creation code for its deployless calls; deploy it, then copy the runtime there.
  await rpc(rpcUrl, "hardhat_setCode", [MULTICALL3, await deployedRuntime(rpcUrl, deployer, multicall3Bytecode)]);
  if ((await rpc(rpcUrl, "eth_getCode", [MULTICALL3, "latest"])).length < 100) throw new Error(`Multicall3 missing on ${chainId}`);
  console.log(`[chain] chain ${chainId} on ${rpcUrl}, mock USDC at ${usdc}, Safe code at ${CLUB_SAFE}, ETH/USD feed at ${ETH_USD_FEED}`);
  // P5: vouches live on Base only, so only the Base Sepolia node gets EAS (after Multicall3).
  if (chainId === 84532) {
    const uid = await prepareEas(rpcUrl);
    console.log(`[chain] chain ${chainId}: EAS at ${EAS_ADDRESS}, schema ${uid}`);
  }
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
