import { beforeEach, describe, expect, it, vi } from "vitest";

const signInWithWeb3 = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({ auth: { signInWithWeb3 } }) }));

import { signInWithWallet } from "@/lib/auth/siwe-sign-in";

const ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
  signInWithWeb3.mockResolvedValue({ data: {}, error: null });
});

describe("signInWithWallet", () => {
  it("signs the SIWE message for the club login uri and opens the Supabase session from the browser", async () => {
    const sign = vi.fn(async () => "0xsig" as const);
    await expect(signInWithWallet({ address: ADDRESS, chainId: 84532, lang: "en", sign })).resolves.toEqual({ ok: true });
    const message = (sign.mock.calls[0] as unknown as [string])[0];
    expect(message).toContain(`URI: ${window.location.origin}/foro/login`);
    expect(message).toContain("Sign in to ElClub.");
    expect(signInWithWeb3).toHaveBeenCalledWith({ chain: "ethereum", message, signature: "0xsig" });
  });

  it("a rejected signature is cancelled, with no Supabase call", async () => {
    const sign = vi.fn(async () => {
      throw Object.assign(new Error("no"), { name: "UserRejectedRequestError" });
    });
    await expect(signInWithWallet({ address: ADDRESS, chainId: 84532, lang: "es", sign })).resolves.toEqual({ ok: false, error: "cancelled" });
    expect(signInWithWeb3).not.toHaveBeenCalled();
  });

  it("another wallet error, a Supabase error or a chain outside the build is verify", async () => {
    const bad = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(signInWithWallet({ address: ADDRESS, chainId: 84532, lang: "es", sign: bad })).resolves.toEqual({ ok: false, error: "verify" });
    signInWithWeb3.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    const ok = vi.fn(async () => "0xsig" as const);
    await expect(signInWithWallet({ address: ADDRESS, chainId: 84532, lang: "es", sign: ok })).resolves.toEqual({ ok: false, error: "verify" });
    await expect(signInWithWallet({ address: ADDRESS, chainId: 1, lang: "es", sign: ok })).resolves.toEqual({ ok: false, error: "verify" });
  });
});
