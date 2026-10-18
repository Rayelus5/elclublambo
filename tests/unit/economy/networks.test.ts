import { describe, expect, it } from "vitest";
import { bpsToPercentText, explorerAddress, explorerTx, NETWORKS, percentTextToBps } from "@/lib/economy/networks";

describe("NETWORKS", () => {
  it("pins the USDC addresses, explorers and testnet flags", () => {
    expect(NETWORKS[59144]).toEqual({
      id: 59144,
      name: "Linea",
      usdc: "0x176211869cA2b568f2A7D4EE941E073a821EE1ff",
      explorer: "https://lineascan.build",
      testnet: false,
    });
    expect(NETWORKS[59141]).toEqual({
      id: 59141,
      name: "Linea Sepolia",
      usdc: "0xFEce4462D57bD51A6A552365A011b95f0E16d9B7",
      explorer: "https://sepolia.lineascan.build",
      testnet: true,
    });
  });

  it("builds explorer links", () => {
    expect(explorerTx(59141, "0xab")).toBe("https://sepolia.lineascan.build/tx/0xab");
    expect(explorerTx(59144, "0xab")).toBe("https://lineascan.build/tx/0xab");
    expect(explorerAddress(59144, "0xcd")).toBe("https://lineascan.build/address/0xcd");
  });
});

describe("percentTextToBps", () => {
  it("accepts comma or dot decimals up to 2 places", () => {
    expect(percentTextToBps("2,6")).toBe(260);
    expect(percentTextToBps("2.6")).toBe(260);
    expect(percentTextToBps("0,05")).toBe(5);
    expect(percentTextToBps("0")).toBe(0);
    expect(percentTextToBps(" 1 ")).toBe(100);
    expect(percentTextToBps("50")).toBe(5000);
  });

  it("rejects out of range or malformed input", () => {
    for (const bad of ["50,01", "51", "100", "1,234", "-1", "", "abc", "1,", ",5", "1e1"]) {
      expect(percentTextToBps(bad), bad).toBeNull();
    }
  });
});

describe("bpsToPercentText", () => {
  it("formats with a decimal comma", () => {
    expect(bpsToPercentText(260)).toBe("2,6 %");
    expect(bpsToPercentText(5)).toBe("0,05 %");
    expect(bpsToPercentText(0)).toBe("0 %");
    expect(bpsToPercentText(5000)).toBe("50 %");
  });
});
