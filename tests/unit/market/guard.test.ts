import { describe, expect, it, vi } from "vitest";
import { coinSegment, isInvalidCoinPage } from "@/lib/market/guard";

function client(status: unknown = "active", error: unknown = null) {
  const rpc = vi.fn(async () => ({ data: status, error }));
  return { rpc };
}

describe("coinSegment", () => {
  it.each([
    ["/mercado/bitcoin", "bitcoin"],
    ["/mercado/bitcoin/", "bitcoin"],
    ["/mercado/..%2Fx", "..%2Fx"],
  ])("%s", (path, seg) => expect(coinSegment(path)).toBe(seg));
  it.each(["/", "/mercado", "/mercado/", "/mercado/bitcoin/x", "/x/mercado/bitcoin", "/dao"])("%s is not a coin page", (p) =>
    expect(coinSegment(p)).toBeNull(),
  );
});

describe("isInvalidCoinPage", () => {
  it("ignores other paths and valid ids without any query", async () => {
    const c = client();
    expect(await isInvalidCoinPage(c as never, "/mercado")).toBe(false);
    expect(await isInvalidCoinPage(c as never, "/mercado/bitcoin")).toBe(false);
    expect(await isInvalidCoinPage(c as never, "/mercado/no-existe")).toBe(false);
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it.each(["/mercado/..%2Fx", "/mercado/BITCOIN", `/mercado/${"a".repeat(200)}`, "/mercado/%E0%A4%A", "/mercado/bit%20coin"])(
    "%s is a 404 for an active member",
    async (p) => expect(await isInvalidCoinPage(client() as never, p)).toBe(true),
  );

  it("is not a 404 for members who are not active (the layout redirects them), nor when the check fails", async () => {
    expect(await isInvalidCoinPage(client("banned") as never, "/mercado/BITCOIN")).toBe(false);
    expect(await isInvalidCoinPage(client(null, { message: "x" }) as never, "/mercado/BITCOIN")).toBe(false);
  });
});
