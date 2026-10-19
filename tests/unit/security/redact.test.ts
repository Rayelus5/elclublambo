import { describe, expect, it } from "vitest";
import { HttpRequestError, RpcRequestError } from "viem";
import { redactUrl, safeError } from "@/lib/security/redact";

const INFURA = "https://linea-mainnet.infura.io/v3/abc123KEY";

describe("safeError", () => {
  it("redacts the RPC key from a viem HttpRequestError", () => {
    const out = safeError(new HttpRequestError({ url: INFURA, body: {} }));
    expect(out).not.toContain("abc123KEY");
    expect(out).toContain("https://linea-mainnet.infura.io/***");
  });

  it("redacts a URL that only appears in the cause chain", () => {
    const rpc = new RpcRequestError({ url: INFURA, body: { method: "eth_call" }, error: { code: -32000, message: "boom" } });
    const out = safeError(new Error("read failed", { cause: rpc }));
    expect(out).toContain("read failed");
    expect(out).not.toContain("abc123KEY");
    expect(out).toContain("https://linea-mainnet.infura.io/***");
  });

  it("redacts query secrets from wss URLs", () => {
    const out = safeError(new Error("socket closed: wss://x.supabase.co/realtime/v1?apikey=SECRET"));
    expect(out).not.toContain("SECRET");
    expect(out).toContain("wss://x.supabase.co/***");
  });

  it("follows at most 3 cause levels", () => {
    const deep = new Error("L4 https://deep.io/k/LEVEL4");
    const e = new Error("L0", { cause: new Error("L1", { cause: new Error("L2", { cause: new Error("L3", { cause: deep }) }) }) });
    const out = safeError(e);
    expect(out).toContain("L3");
    expect(out).not.toContain("L4");
  });

  it("handles plain values and PostgREST-like objects", () => {
    expect(safeError("plain")).toBe("plain");
    expect(safeError(undefined)).toBe("unknown");
    expect(safeError(null)).toBe("unknown");
    expect(safeError({ message: "rpc said https://h.io/v3/KEY", code: "P0001" })).not.toContain("KEY");
    expect(safeError(42)).toBe("42");
  });

  it("never throws, even on hostile inputs", () => {
    const hostile = {
      get message(): string {
        throw new Error("nope");
      },
    };
    expect(() => safeError(hostile)).not.toThrow();
    const cyclic = new Error("cyclic");
    (cyclic as { cause?: unknown }).cause = cyclic;
    expect(() => safeError(cyclic)).not.toThrow();
  });
});

describe("redactUrl", () => {
  it("keeps only the origin and drops userinfo, path, query and hash", () => {
    expect(redactUrl("https://u:p@h.io/v3/k?x=1")).toBe("https://h.io/***");
    expect(redactUrl("https://h.io:8545/x#frag")).toBe("https://h.io:8545/***");
  });

  it("marks invalid input", () => {
    expect(redactUrl("not a url")).toBe("(invalid url)");
    expect(redactUrl("")).toBe("(invalid url)");
  });
});
