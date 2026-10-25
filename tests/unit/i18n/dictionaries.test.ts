import { describe, expect, it } from "vitest";
import { es } from "../../../src/lib/i18n/dictionaries/es";
import { en } from "../../../src/lib/i18n/dictionaries/en";
import { getDictionary } from "../../../src/lib/i18n";

// Cadenas que se escriben igual en ambos idiomas.
const SAME_ALLOWED = new Set([
  "ElClub.", "ElClub Pay", "drand", "USDC", "Base", "Arbitrum",
  "Safe", "ETH", "MetaMask", "OKX Wallet", "DexScreener", "P2P", "On-chain", "Ctrl+K", "Mecenas", "0 gas", "Alphas", "Bounties", "Bounty", "Chat", "Roles",
  "Bounty · 150 USDC", "GM GM GM GM GM", "wen lambo", "pump pump pump", "No",
]);

type Tree = { [k: string]: string | Tree };

function walk(a: Tree, b: Tree, path: string, out: string[]) {
  expect(Object.keys(b).sort(), `keys at ${path || "root"}`).toEqual(Object.keys(a).sort());
  for (const key of Object.keys(a)) {
    const here = path ? `${path}.${key}` : key;
    const va = a[key] as string | Tree;
    const vb = b[key] as string | Tree;
    if (typeof va === "string") {
      expect(typeof vb, here).toBe("string");
      expect(va.trim(), `es ${here}`).not.toBe("");
      expect((vb as string).trim(), `en ${here}`).not.toBe("");
      if (va === vb && !SAME_ALLOWED.has(va)) out.push(here);
    } else {
      expect(typeof vb, here).toBe("object");
      walk(va, vb as Tree, here, out);
    }
  }
}

describe("dictionaries", () => {
  it("es and en share keys, no empty strings, no untranslated EN", () => {
    const same: string[] = [];
    walk(es as unknown as Tree, en as unknown as Tree, "", same);
    expect(same).toEqual([]);
  });

  it("getDictionary picks by language", () => {
    expect(getDictionary("es")).toBe(es);
    expect(getDictionary("en")).toBe(en);
  });

  it("common has the nav and the no-custody notice", () => {
    expect(es.common.noCustody).toBe("ElClub. no custodia fondos.");
    expect(en.common.noCustody).toBe("ElClub. never holds your funds.");
  });
});
