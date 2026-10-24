// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { DRAND, roundTime, verifyBeacon } from "@/lib/giveaways/drand";
import { handle, MOCK_PUBLIC_KEY, MOCK_DRAND_PORT } from "../../../e2e/mock/drand.mjs";

// P1-R11: the e2e drand (e2e/mock/drand.mjs) signs with its own BLS key, same genesis and period, 425 for future rounds.
let server: Server | null = null;
async function start(): Promise<string> {
  server = createServer(handle);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}
afterEach(async () => {
  vi.useRealTimers();
  if (server) await new Promise((r) => server!.close(r));
  server = null;
});

describe("e2e drand mock", () => {
  it("has a fixed port and a 96-byte G2 public key different from quicknet's", () => {
    expect(MOCK_DRAND_PORT).toBe(8551);
    expect(MOCK_PUBLIC_KEY).toMatch(/^[0-9a-f]{192}$/);
    expect(MOCK_PUBLIC_KEY).not.toBe(DRAND.publicKey);
  });

  it("serves a beacon that verifies against its key (and not against quicknet's)", async () => {
    const base = await start();
    const res = await fetch(`${base}/${DRAND.chainHash}/public/1000`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { round: number; signature: string; randomness: string };
    expect(body.round).toBe(1000);
    expect(verifyBeacon(1000n, body.signature, MOCK_PUBLIC_KEY)).toEqual({ ok: true, randomness: body.randomness });
    expect(verifyBeacon(1000n, body.signature)).toEqual({ ok: false });
  });

  it("answers 425 for a round not emitted yet, 404 for another chain hash", async () => {
    const base = await start();
    const future = BigInt(Math.floor((Date.now() / 1000 - DRAND.genesis) / DRAND.period)) + 100n;
    expect(roundTime(future) * 1000).toBeGreaterThan(Date.now());
    expect((await fetch(`${base}/${DRAND.chainHash}/public/${future}`)).status).toBe(425);
    expect((await fetch(`${base}/${"0".repeat(64)}/public/1000`)).status).toBe(404);
  });

  it("/info describes the same chain with the test key", async () => {
    const base = await start();
    const info = (await (await fetch(`${base}/info`)).json()) as Record<string, unknown>;
    expect(info).toMatchObject({ public_key: MOCK_PUBLIC_KEY, period: 3, genesis_time: 1692803367, hash: DRAND.chainHash, schemeID: "bls-unchained-g1-rfc9380" });
  });

  it("POST /__fail makes every beacon 503 until /__ok", async () => {
    const base = await start();
    await fetch(`${base}/__fail`, { method: "POST" });
    expect((await fetch(`${base}/${DRAND.chainHash}/public/1000`)).status).toBe(503);
    await fetch(`${base}/__ok`, { method: "POST" });
    expect((await fetch(`${base}/${DRAND.chainHash}/public/1000`)).status).toBe(200);
  });
});
