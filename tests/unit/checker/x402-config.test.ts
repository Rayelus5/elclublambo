// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { CLUB_SAFE, DEFAULT_PRICE, PUBLIC_FACILITATOR_URL, x402Config } from "@/lib/checker/x402";

const PAY_TO = "0x1111111111111111111111111111111111111111";

describe("x402Config (P4-R4)", () => {
  it("is off by default: X402_ENABLED empty or anything but true", () => {
    expect(x402Config({})).toEqual({ enabled: false, reason: "disabled" });
    expect(x402Config({ X402_ENABLED: "" })).toEqual({ enabled: false, reason: "disabled" });
    expect(x402Config({ X402_ENABLED: "1" })).toEqual({ enabled: false, reason: "disabled" });
    expect(x402Config({ X402_ENABLED: "false", X402_NETWORK: "eip155:84532" })).toEqual({ enabled: false, reason: "disabled" });
  });

  it("Base Sepolia with the public facilitator, the club Safe and $0.01 by default", () => {
    expect(x402Config({ X402_ENABLED: "true" })).toEqual({
      enabled: true,
      network: "eip155:84532",
      price: DEFAULT_PRICE,
      payTo: CLUB_SAFE,
      facilitator: "public",
      facilitatorUrl: PUBLIC_FACILITATOR_URL,
    });
    expect(DEFAULT_PRICE).toBe("$0.01");
    expect(CLUB_SAFE).toBe("0x380f2e12081995359e2Ab88E3c31c6b227904234");
    expect(PUBLIC_FACILITATOR_URL).toBe("https://x402.org/facilitator");
  });

  it("honours the network, price, payTo and facilitator URL", () => {
    expect(
      x402Config({
        X402_ENABLED: " TRUE ",
        X402_NETWORK: "eip155:84532",
        X402_PRICE: "$0.05",
        X402_PAY_TO: PAY_TO,
        X402_FACILITATOR_URL: "https://facilitator.example/x402/",
      }),
    ).toEqual({
      enabled: true,
      network: "eip155:84532",
      price: "$0.05",
      payTo: PAY_TO,
      facilitator: "public",
      facilitatorUrl: "https://facilitator.example/x402",
    });
  });

  it("mainnet without the CDP keys stays free (missing_cdp_keys)", () => {
    expect(x402Config({ X402_ENABLED: "true", X402_NETWORK: "eip155:8453" })).toEqual({ enabled: false, reason: "missing_cdp_keys" });
    expect(x402Config({ X402_ENABLED: "true", X402_NETWORK: "eip155:8453", CDP_API_KEY_ID: "id" })).toEqual({
      enabled: false,
      reason: "missing_cdp_keys",
    });
  });

  it("mainnet with the CDP keys uses the CDP facilitator (the secret never enters the config)", () => {
    const cfg = x402Config({ X402_ENABLED: "true", X402_NETWORK: "eip155:8453", CDP_API_KEY_ID: "id", CDP_API_KEY_SECRET: "secret" });
    expect(cfg).toEqual({ enabled: true, network: "eip155:8453", price: "$0.01", payTo: CLUB_SAFE, facilitator: "cdp" });
    expect(JSON.stringify(cfg)).not.toContain("secret");
  });

  it("an unsupported network, a bad price, payTo or facilitator URL disable it", () => {
    expect(x402Config({ X402_ENABLED: "true", X402_NETWORK: "eip155:42161" })).toEqual({ enabled: false, reason: "unsupported_network" });
    expect(x402Config({ X402_ENABLED: "true", X402_NETWORK: "base" })).toEqual({ enabled: false, reason: "unsupported_network" });
    for (const price of ["0.01", "$0", "$-1", "$abc", "$0.0000001", "$1000"]) {
      expect(x402Config({ X402_ENABLED: "true", X402_PRICE: price }), price).toEqual({ enabled: false, reason: "invalid_price" });
    }
    expect(x402Config({ X402_ENABLED: "true", X402_PAY_TO: "0x123" })).toEqual({ enabled: false, reason: "invalid_pay_to" });
    expect(x402Config({ X402_ENABLED: "true", X402_FACILITATOR_URL: "http://x402.org/facilitator" })).toEqual({
      enabled: false,
      reason: "invalid_facilitator_url",
    });
    expect(x402Config({ X402_ENABLED: "true", X402_FACILITATOR_URL: "not a url" })).toEqual({ enabled: false, reason: "invalid_facilitator_url" });
  });
});
