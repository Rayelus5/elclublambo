// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { DRAND, DRAND_API_BASES, drandConfig, fetchBeacon, roundTime, targetRound, verifyBeacon } from "@/lib/giveaways/drand";

// Real quicknet round 1000 (implementer-common, verified on api.drand.sh 2026-10-24).
const SIG = "b44679b9a59af2ec876b1a6b1ad52ea9b1615fc3982b19576350f93447cb1125e342b73a8dd2bacbe47e4b6b63ed5e39";
const RANDOMNESS = "fe290beca10872ef2fb164d2aa4442de4566183ec51c56ff3cd603d930e54fdd";
const TAMPERED = `${SIG.slice(0, -2)}${SIG.endsWith("39") ? "3a" : "39"}`;

afterEach(() => vi.unstubAllEnvs());

describe("DRAND quicknet constants", () => {
  it("pins the verified chain values", () => {
    expect(DRAND).toEqual({
      chainHash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
      publicKey:
        "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
      genesis: 1692803367,
      period: 3,
      dst: "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_",
    });
    expect(DRAND_API_BASES).toEqual(["https://api.drand.sh", "https://api2.drand.sh", "https://api3.drand.sh", "https://drand.cloudflare.com"]);
  });

  it("roundTime: round r is emitted at genesis + (r - 1) * 3", () => {
    expect(roundTime(1n)).toBe(1692803367);
    expect(roundTime(1000n)).toBe(1692803367 + 999 * 3);
  });

  it("targetRound mirrors SQL _giveaway_target_round: the first round strictly after the close", () => {
    // closes exactly on round 1000's emission -> 1001
    expect(targetRound(new Date(roundTime(1000n) * 1000))).toBe(1001n);
    // half a second after round 1000 -> 1001
    expect(targetRound(new Date(roundTime(1000n) * 1000 + 500))).toBe(1001n);
    // one ms before round 1000 -> 1000
    expect(targetRound(new Date(roundTime(1000n) * 1000 - 1))).toBe(1000n);
  });
});

describe("verifyBeacon", () => {
  it("accepts the real round 1000 and derives randomness = sha256(signature)", () => {
    expect(verifyBeacon(1000n, SIG)).toEqual({ ok: true, randomness: RANDOMNESS });
    expect(verifyBeacon(1000n, `0x${SIG.toUpperCase()}`)).toEqual({ ok: true, randomness: RANDOMNESS });
  });
  it("rejects the same signature for round 1001, a tampered signature and garbage", () => {
    expect(verifyBeacon(1001n, SIG)).toEqual({ ok: false });
    expect(verifyBeacon(1000n, TAMPERED)).toEqual({ ok: false });
    expect(verifyBeacon(1000n, "abcd")).toEqual({ ok: false });
    expect(verifyBeacon(0n, SIG)).toEqual({ ok: false });
    expect(verifyBeacon(1000n, "zz".repeat(48))).toEqual({ ok: false });
  });
  it("rejects a valid signature against another public key", () => {
    const other = `${DRAND.publicKey.slice(0, -2)}00`;
    expect(verifyBeacon(1000n, SIG, other)).toEqual({ ok: false });
  });
});

describe("drandConfig (P1-R11)", () => {
  it("uses the four public bases and the real key by default", () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
    vi.stubEnv("NEXT_PUBLIC_DRAND_API_BASE", "");
    vi.stubEnv("DRAND_API_BASE", "");
    vi.stubEnv("NEXT_PUBLIC_DRAND_PUBLIC_KEY", "");
    expect(drandConfig()).toEqual({ apiBases: [...DRAND_API_BASES], publicKey: DRAND.publicKey });
  });
  it("honours the overrides on testnet only, the server base first", () => {
    const key = "ab".repeat(96);
    vi.stubEnv("NEXT_PUBLIC_DRAND_API_BASE", "http://127.0.0.1:8551/");
    vi.stubEnv("DRAND_API_BASE", "http://localhost:8551");
    vi.stubEnv("NEXT_PUBLIC_DRAND_PUBLIC_KEY", key);
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
    expect(drandConfig()).toEqual({ apiBases: ["http://localhost:8551"], publicKey: key });
    vi.stubEnv("DRAND_API_BASE", "");
    expect(drandConfig().apiBases).toEqual(["http://127.0.0.1:8551"]);
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "mainnet");
    expect(drandConfig()).toEqual({ apiBases: [...DRAND_API_BASES], publicKey: DRAND.publicKey });
  });
  it("ignores a malformed key or base", () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
    vi.stubEnv("DRAND_API_BASE", "ftp://x");
    vi.stubEnv("NEXT_PUBLIC_DRAND_API_BASE", "not a url");
    vi.stubEnv("NEXT_PUBLIC_DRAND_PUBLIC_KEY", "1234");
    expect(drandConfig()).toEqual({ apiBases: [...DRAND_API_BASES], publicKey: DRAND.publicKey });
  });
});

describe("fetchBeacon", () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const beacon = { round: 1000, randomness: RANDOMNESS, signature: SIG };

  it("tries the next base when one answers 500, and returns the verified beacon", async () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "mainnet");
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      return urls.length === 1 ? new Response("boom", { status: 500 }) : json(beacon);
    }) as unknown as typeof fetch;
    expect(await fetchBeacon(1000n, { fetchImpl })).toEqual({ status: "ok", signature: SIG, randomness: RANDOMNESS });
    expect(urls).toEqual([`https://api.drand.sh/${DRAND.chainHash}/public/1000`, `https://api2.drand.sh/${DRAND.chainHash}/public/1000`]);
  });

  it("passes a 5 s timeout signal to every request", async () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "mainnet");
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetchImpl = vi.fn(async () => json(beacon)) as unknown as typeof fetch;
    await fetchBeacon(1000n, { fetchImpl });
    expect(timeout).toHaveBeenCalledWith(5000);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatchObject({ signal: expect.any(AbortSignal) });
    timeout.mockRestore();
  });

  it("unavailable when every base fails (5xx, 425 not yet emitted, network error, bad JSON)", async () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "mainnet");
    const answers = [
      () => new Response("x", { status: 503 }),
      () => json({ error: "too early" }, 425),
      () => {
        throw new TypeError("fetch failed");
      },
      () => new Response("not json", { status: 200 }),
    ];
    let i = 0;
    const fetchImpl = vi.fn(async () => answers[i++]!()) as unknown as typeof fetch;
    expect(await fetchBeacon(1000n, { fetchImpl })).toEqual({ status: "unavailable" });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("invalid when the only answers carry a signature that does not verify", async () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "mainnet");
    const fetchImpl = vi.fn(async () => json({ ...beacon, signature: TAMPERED })) as unknown as typeof fetch;
    expect(await fetchBeacon(1000n, { fetchImpl })).toEqual({ status: "invalid" });
  });

  it("a tampered answer from one base does not hide a valid one from the next", async () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "mainnet");
    let i = 0;
    const fetchImpl = vi.fn(async () => (i++ === 0 ? json({ ...beacon, signature: TAMPERED }) : json(beacon))) as unknown as typeof fetch;
    expect(await fetchBeacon(1000n, { fetchImpl })).toMatchObject({ status: "ok" });
  });

  it("the signature of another round is invalid (the requested round is the message)", async () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "mainnet");
    const fetchImpl = vi.fn(async () => json(beacon)) as unknown as typeof fetch;
    expect(await fetchBeacon(1001n, { fetchImpl })).toEqual({ status: "invalid" });
  });
});
