// TEST-ONLY local drand (P1-R11): quicknet's chain hash, genesis and period, but every round is signed with a fixed
// test BLS key, so the e2e giveaways draw without touching the real drand. The app reaches it through DRAND_API_BASE /
// NEXT_PUBLIC_DRAND_API_BASE and verifies with NEXT_PUBLIC_DRAND_PUBLIC_KEY (playwright.config.ts), which
// src/lib/giveaways/drand.ts honours on the testnet set only.
//   GET  /<chainHash>/public/<round>   { round, randomness, signature }; 425 while the round is not emitted yet
//   GET  /info, /<chainHash>/info      chain info with the test public key
//   POST /__fail | /__ok               every beacon answers 503 until /__ok (drand down, Review Focus 5)
//   GET  /__health                     readiness (Playwright webServer url)
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { bls12_381 } from "@noble/curves/bls12-381";

export const MOCK_DRAND_PORT = 8551;

const CHAIN_HASH = "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";
const GENESIS = 1692803367;
const PERIOD = 3;
const DST = "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_";
/** TEST-ONLY BLS secret key (generated for e2e, worthless anywhere else). */
const TEST_SECRET_KEY = "2e".repeat(32);

export const MOCK_PUBLIC_KEY = Buffer.from(bls12_381.getPublicKeyForShortSignatures(TEST_SECRET_KEY)).toString("hex");

const roundTime = (round) => GENESIS + (round - 1) * PERIOD;

/** Signs `round` like quicknet: BLS on G1 of sha256(round as uint64 big-endian); randomness = sha256(signature). */
export function signRound(round) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(round));
  const point = bls12_381.G1.hashToCurve(createHash("sha256").update(msg).digest(), { DST });
  const signature = bls12_381.signShortSignature(point, TEST_SECRET_KEY).toHex(true);
  const randomness = createHash("sha256").update(Buffer.from(signature, "hex")).digest("hex");
  return { round, randomness, signature };
}

let failing = false;

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

const INFO = {
  public_key: MOCK_PUBLIC_KEY,
  period: PERIOD,
  genesis_time: GENESIS,
  hash: CHAIN_HASH,
  groupHash: "0".repeat(64),
  schemeID: "bls-unchained-g1-rfc9380",
  metadata: { beaconID: "quicknet" },
};

export function handle(req, res) {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${MOCK_DRAND_PORT}`);
  const path = url.pathname;
  if (path === "/__health") return send(res, 200, { ok: true, failing });
  if (req.method === "POST" && path === "/__fail") {
    failing = true;
    return send(res, 200, { failing });
  }
  if (req.method === "POST" && path === "/__ok") {
    failing = false;
    return send(res, 200, { failing });
  }
  if (req.method !== "GET") return send(res, 404, { error: "not found" });
  if (path === "/info" || path === `/${CHAIN_HASH}/info`) return send(res, 200, INFO);

  const m = /^\/([0-9a-f]{64})\/public\/(\d{1,15})$/.exec(path);
  if (!m || m[1] !== CHAIN_HASH) return send(res, 404, { error: "not found" });
  if (failing) return send(res, 503, { error: "service unavailable" });
  const round = Number(m[2]);
  if (round < 1) return send(res, 404, { error: "not found" });
  if (roundTime(round) > Date.now() / 1000) return send(res, 425, { error: "round not emitted yet" });
  return send(res, 200, signRound(round));
}

// Started directly (`node e2e/mock/drand.mjs`): listen. Imported: only the handler and the key are used.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createServer(handle).listen(MOCK_DRAND_PORT, "127.0.0.1", () => console.log(`mock drand on http://127.0.0.1:${MOCK_DRAND_PORT}`));
}
