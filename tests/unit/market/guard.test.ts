import { describe, expect, it, vi } from "vitest";
import { coinSegment, isInvalidCoinPage } from "@/lib/market/guard";

function client(status: unknown = "active", error: unknown = null) {
  const rpc = vi.fn(async () => ({ data: status, error }));
  return { rpc };
}

describe("coinSegment", () => {
  it.each([
    ["/foro/mercado/bitcoin", "bitcoin"],
    ["/foro/mercado/bitcoin/", "bitcoin"],
    ["/foro/mercado/..%2Fx", "..%2Fx"],
  ])("%s", (path, seg) => expect(coinSegment(path)).toBe(seg));
  it.each(["/", "/foro/mercado", "/foro/mercado/", "/foro/mercado/bitcoin/x", "/foro/x/mercado/bitcoin", "/foro/dao", "/mercado/bitcoin", "/mercado/BITCOIN"])("%s is not a coin page", (p) =>
    expect(coinSegment(p)).toBeNull(),
  );
});

describe("isInvalidCoinPage", () => {
  it("ignores other paths and valid ids without any query", async () => {
    const c = client();
    expect(await isInvalidCoinPage(c as never, "/foro/mercado")).toBe(false);
    expect(await isInvalidCoinPage(c as never, "/foro/mercado/bitcoin")).toBe(false);
    expect(await isInvalidCoinPage(c as never, "/foro/mercado/no-existe")).toBe(false);
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it.each(["/foro/mercado/..%2Fx", "/foro/mercado/BITCOIN", `/foro/mercado/${"a".repeat(200)}`, "/foro/mercado/%E0%A4%A", "/foro/mercado/bit%20coin"])(
    "%s is a 404 for an active member",
    async (p) => expect(await isInvalidCoinPage(client() as never, p)).toBe(true),
  );

  it("is not a 404 for members who are not active (the layout redirects them), nor when the check fails", async () => {
    expect(await isInvalidCoinPage(client("banned") as never, "/foro/mercado/BITCOIN")).toBe(false);
    expect(await isInvalidCoinPage(client(null, { message: "x" }) as never, "/foro/mercado/BITCOIN")).toBe(false);
  });
});
