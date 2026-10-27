// RPC readiness checker (F5-R9). Run before pointing the app at an RPC:
//   pnpm check:rpc --chain 8453       (reads .env.local, then .env, from the current folder; real env vars win)
//   pnpm check:rpc                    (every network of NEXT_PUBLIC_NETWORK_SET)
// Checks the chain id, archive state (eth_call ~1M blocks back) and eth_getLogs over a 2001-block range
// (the app scans in 2000-block chunks). The RPC URL holds the provider key, so it is never printed:
// only `origin/***`, and every output line passes through `sanitize`.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Loads `.env.local`, then `.env`, from `cwd` when they exist. `process.loadEnvFile` never overrides a variable that is
 * already set, so the shell's own env wins and `.env.local` wins over `.env`.
 * @param {string} cwd
 * @param {(p: string) => boolean} [exists]
 * @param {(p: string) => void} [load]
 */
export function loadLocalEnv(cwd, exists = existsSync, load = (p) => process.loadEnvFile(p)) {
  for (const name of [".env.local", ".env"]) {
    const p = join(cwd, name);
    if (exists(p)) load(p);
  }
}

/** Same addresses as `NETWORKS[...].usdc` in src/lib/economy/networks.ts (a unit test pins them equal). */
export const CHAINS = {
  8453: { name: "Base", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", rpcEnv: "BASE_RPC_URL" },
  42161: { name: "Arbitrum", usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", rpcEnv: "ARBITRUM_RPC_URL" },
  84532: { name: "Base Sepolia", usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", rpcEnv: "BASE_SEPOLIA_RPC_URL" },
  421614: { name: "Arbitrum Sepolia", usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", rpcEnv: "ARBITRUM_SEPOLIA_RPC_URL" },
};

/** @typedef {8453 | 42161 | 84532 | 421614} ChainId */

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const TOTAL_SUPPLY = "0x18160ddd";
const ARCHIVE_DEPTH = 1_000_000n;
const TIMEOUT_MS = 15_000;

/**
 * `--chain <id>` gives that one network; without it, every network of NEXT_PUBLIC_NETWORK_SET (unset or empty is
 * testnet, same rule as networkSet() in src/lib/economy/networks.ts).
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @returns {ChainId[]}
 */
export function resolveChains(argv, env) {
  const i = argv.indexOf("--chain");
  if (i !== -1) {
    const id = Number(argv[i + 1]);
    if (id === 8453 || id === 42161 || id === 84532 || id === 421614) return [id];
    throw new Error("chain_invalid");
  }
  const set = env.NEXT_PUBLIC_NETWORK_SET;
  if (set === "mainnet") return [8453, 42161];
  if (set === undefined || set === "" || set === "testnet") return [84532, 421614];
  throw new Error("chain_invalid");
}

/**
 * `origin + "/***"`, same contract as `redactUrl` in src/lib/security/redact.ts.
 * @param {string} url
 */
export function redactUrl(url) {
  try {
    const u = new URL(url);
    if (!/^(https?|wss?):$/.test(u.protocol) || !u.host) return "(invalid url)";
    return `${u.protocol}//${u.host}/***`;
  } catch {
    return "(invalid url)";
  }
}

/**
 * Replaces the full URL, any URL-looking text, and every path / query / userinfo segment of length >= 8
 * of `url` with `***`.
 * @param {string} text
 * @param {string} url
 */
export function sanitize(text, url) {
  let out = String(text);
  const secrets = new Set([url]);
  try {
    const u = new URL(url);
    for (const part of [...u.pathname.split("/"), ...u.search.slice(1).split(/[&=]/), u.username, u.password]) {
      let p = part;
      try {
        p = decodeURIComponent(part);
      } catch {
        /* keep raw */
      }
      if (part.length >= 8) secrets.add(part);
      if (p.length >= 8) secrets.add(p);
    }
  } catch {
    /* not a URL: only the generic pass below applies */
  }
  for (const s of [...secrets].sort((a, b) => b.length - a.length)) out = out.split(s).join("***");
  return out.replace(/\b(?:https?|wss?):\/\/[^\s"'<>`]+/gi, (m) => {
    const r = redactUrl(m);
    return r === "(invalid url)" ? "***" : r;
  });
}

/**
 * JSON-RPC 2.0 call. Errors never include the URL.
 * @param {string} url
 * @param {string} method
 * @param {unknown[]} params
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<unknown>}
 */
export async function rpc(url, method, params, fetchImpl = fetch) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${method}: ${res.status} HTTP error`);
  const body = await res.json();
  if (body && body.error) throw new Error(`${method}: ${body.error.code} ${body.error.message}`);
  return body?.result;
}

const hex = (n) => "0x" + n.toString(16);

/**
 * @param {string} url
 * @param {ChainId} chainId
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ ok: boolean; lines: string[] }>}
 */
export async function checkRpc(url, chainId, fetchImpl = fetch) {
  const { usdc } = CHAINS[chainId];
  /** @type {string[]} */
  const lines = [];
  const fail = (label, e) => {
    lines.push(sanitize(`FAIL ${label}: ${e instanceof Error ? e.message : String(e)}`, url));
    return { ok: false, lines };
  };

  let step = "eth_chainId";
  try {
    const id = Number(await rpc(url, "eth_chainId", [], fetchImpl));
    if (id !== chainId) return fail(step, `expected ${chainId}, got ${id}`);
    lines.push(`OK eth_chainId ${id}`);

    step = "eth_blockNumber";
    const latest = BigInt(await rpc(url, "eth_blockNumber", [], fetchImpl));
    lines.push(`OK eth_blockNumber ${latest}`);

    step = "archive";
    const old = latest - ARCHIVE_DEPTH > 1n ? latest - ARCHIVE_DEPTH : 1n;
    const supply = await rpc(url, "eth_call", [{ to: usdc, data: TOTAL_SUPPLY }, hex(old)], fetchImpl);
    if (typeof supply !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(supply)) {
      return fail(step, "eth_call did not return a 32-byte word");
    }
    lines.push(`OK archive state at block ${old}`);

    step = "eth_getLogs";
    const from = latest - 2100n;
    const to = latest - 100n;
    const logs = await rpc(
      url,
      "eth_getLogs",
      [{ address: usdc, fromBlock: hex(from), toBlock: hex(to), topics: [TRANSFER_TOPIC, null, "0x" + "0".repeat(63) + "1"] }],
      fetchImpl,
    );
    if (!Array.isArray(logs)) return fail(step, "result is not an array");
    lines.push(`OK eth_getLogs over ${to - from + 1n} blocks`);
    return { ok: true, lines };
  } catch (e) {
    return fail(step, e);
  }
}

export async function main() {
  loadLocalEnv(process.cwd());
  let chains;
  try {
    chains = resolveChains(process.argv.slice(2), process.env);
  } catch {
    console.log("Cadena no valida: usa --chain 8453|42161|84532|421614, o NEXT_PUBLIC_NETWORK_SET=mainnet|testnet");
    return 2;
  }
  let code = 0;
  for (const chainId of chains) {
    const { name, rpcEnv } = CHAINS[chainId];
    const url = process.env[rpcEnv];
    if (!url) {
      console.log(`Falta la variable ${rpcEnv}`);
      code = Math.max(code, 2);
      continue;
    }
    console.log(`Comprobando ${redactUrl(url)} en ${name} (${chainId})`);
    const { ok, lines } = await checkRpc(url, chainId);
    for (const l of lines) console.log(l);
    if (!ok) code = Math.max(code, 1);
  }
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      console.log("FAIL inesperado");
      process.exitCode = 1;
    },
  );
}
