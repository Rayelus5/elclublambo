// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { CHAIN_IDS } from "@/lib/economy/networks";
import { KNOWN_SPENDERS, PERMIT2, spenderLabel } from "@/lib/approvals/spenders";

describe("KNOWN_SPENDERS (P6-R2c)", () => {
  it("lists only EIP-55 checksummed addresses, without duplicates per chain", () => {
    for (const chain of CHAIN_IDS) {
      const list = KNOWN_SPENDERS[chain];
      for (const s of list) {
        expect(getAddress(s.address)).toBe(s.address);
        expect(s.label.trim()).not.toBe("");
      }
      const lower = list.map((s) => s.address.toLowerCase());
      expect(new Set(lower).size).toBe(lower.length);
    }
  });

  it("has Permit2 on the four chains", () => {
    expect(PERMIT2).toBe("0x000000000022D473030F116dDEE9F6B43aC78BA3");
    for (const chain of CHAIN_IDS) expect(KNOWN_SPENDERS[chain].some((s) => s.address === PERMIT2 && s.label === "Permit2")).toBe(true);
  });

  it("pins the verified mainnet routers", () => {
    const base = KNOWN_SPENDERS[8453].map((s) => s.address);
    const arb = KNOWN_SPENDERS[42161].map((s) => s.address);
    expect(base).toEqual(
      expect.arrayContaining([
        "0x6fF5693b99212Da76ad316178A184AB56D299b43",
        "0x2626664c2603336E57B271c5C0b26F421741e481",
        "0x111111125421cA6dc452d289314280a0f8842A65",
        "0x0000000000001fF3684f28c67538d4D072C22734",
        "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
      ]),
    );
    expect(arb).toEqual(
      expect.arrayContaining([
        "0xA51afAFe0263b40EdaEf0Df8781eA9aa03E381a3",
        "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
        "0x111111125421cA6dc452d289314280a0f8842A65",
        "0x0000000000001fF3684f28c67538d4D072C22734",
      ]),
    );
    // Aerodrome lives on Base only.
    expect(arb).not.toContain("0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43");
  });
});

describe("spenderLabel", () => {
  it("matches case-insensitively", () => {
    expect(spenderLabel(8453, PERMIT2.toLowerCase())).toBe("Permit2");
    expect(spenderLabel(42161, "0xa51afafe0263b40edaef0df8781ea9aa03e381a3")).toBe("Uniswap Universal Router");
  });
  it("is null for an unknown address or one known on another chain only", () => {
    expect(spenderLabel(8453, "0x00000000000000000000000000000000000000aa")).toBeNull();
    expect(spenderLabel(42161, "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43")).toBeNull();
    expect(spenderLabel(8453, "not an address")).toBeNull();
  });
});
