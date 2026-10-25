import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { lineId, listKey, MAX_RECIPIENTS, parseRecipients } from "@/lib/multisend/parse";
import { decodeLines, encodeLines } from "@/lib/multisend/fragment";

const A = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const B = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const C = "0x90f79bf6eb2c4f870365e785982e1f101e93b906";
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const addr = (i: number) => `0x${(i + 1).toString(16).padStart(40, "0")}`;

describe("parseRecipients", () => {
  it("a decimal comma after the separator comma: 0x…,12,5 is 12 500 000 units", () => {
    const r = parseRecipients(`${A},12,5`, 84532);
    expect(r.errors).toEqual([]);
    expect(r.recipients).toEqual([{ line: 1, to: getAddress(A), amount: 12_500_000n, id: `${A}:12500000:0` }]);
    expect(r.total).toBe(12_500_000n);
  });

  it("tab, semicolon and spaces are separators; blank lines are ignored but keep their numbers", () => {
    const r = parseRecipients(`${A}\t1\n\n${B};2.5\n   \n${C}   3`, 84532);
    expect(r.errors).toEqual([]);
    expect(r.recipients.map((x) => [x.line, x.amount])).toEqual([
      [1, 1_000_000n],
      [3, 2_500_000n],
      [5, 3_000_000n],
    ]);
  });

  it("the same address in upper and lower case is one row with the sum, and merged lists both lines", () => {
    const upper = `0x${A.slice(2).toUpperCase()}`;
    const r = parseRecipients(`${A},10\n${B},5\n${upper},2,5`, 84532);
    expect(r.errors).toEqual([]);
    expect(r.recipients).toEqual([
      { line: 1, to: getAddress(A), amount: 12_500_000n, id: `${A}:12500000:0` },
      { line: 2, to: getAddress(B), amount: 5_000_000n, id: `${B}:5000000:0` },
    ]);
    expect(r.merged).toEqual([{ to: getAddress(A), lines: [1, 3] }]);
    expect(r.total).toBe(17_500_000n);
  });

  it.each([
    [`${A},1.1234567`, "too_many_decimals"],
    [`${A},1,1234567`, "too_many_decimals"],
    [`${A},0`, "zero_amount"],
    [`${A},0,000000`, "zero_amount"],
    [`${A},-1`, "bad_amount"],
    [`${A},abc`, "bad_amount"],
    [`${A}`, "bad_amount"],
    [`0x${"0".repeat(40)},1`, "zero_address"],
    [`${USDC_BASE_SEPOLIA},1`, "token_contract"],
    [`${USDC_BASE_SEPOLIA.toLowerCase()},1`, "token_contract"],
    ["0x1234,1", "bad_address"],
    ["hola,1", "bad_address"],
    // Mixed case with a wrong checksum is a typo, not an address.
    [`0x70997970C51812dc3A010C7d01b50e0d17dc79c9,1`, "bad_address"],
  ])("%s → %s", (text, code) => {
    const r = parseRecipients(text, 84532);
    expect(r.errors).toEqual([{ line: 1, code }]);
    expect(r.recipients).toEqual([]);
    expect(r.total).toBe(0n);
  });

  it("the USDC of the other network is not this network's token contract", () => {
    expect(parseRecipients(`${USDC_BASE_SEPOLIA},1`, 421614).errors).toEqual([]);
  });

  it("21 valid lines: too_many on the 21st, the first 20 stay", () => {
    expect(MAX_RECIPIENTS).toBe(20);
    const text = Array.from({ length: 21 }, (_, i) => `${addr(i)},1`).join("\n");
    const r = parseRecipients(text, 84532);
    expect(r.errors).toEqual([{ line: 21, code: "too_many" }]);
    expect(r.recipients).toHaveLength(20);
    expect(r.total).toBe(20_000_000n);
  });

  it("total is the sum of the valid rows; an invalid line does not count", () => {
    const r = parseRecipients(`${A},1,5\n${B},x\n${C},2,25`, 84532);
    expect(r.total).toBe(3_750_000n);
    expect(r.errors).toEqual([{ line: 2, code: "bad_amount" }]);
  });
});

describe("listKey", () => {
  it("is the same whatever the capitalisation or the order, and changes with the chain or an amount", () => {
    const lower = parseRecipients(`${A},1\n${B},2`, 84532).recipients;
    const upper = parseRecipients(`0x${A.slice(2).toUpperCase()},1\n${getAddress(B)},2`, 84532).recipients;
    expect(listKey(84532, lower)).toBe(listKey(84532, upper));
    expect(listKey(84532, lower)).toMatch(/^[0-9a-f]{32}$/);
    expect(listKey(421614, lower)).not.toBe(listKey(84532, lower));
    expect(listKey(84532, parseRecipients(`${A},1\n${B},3`, 84532).recipients)).not.toBe(listKey(84532, lower));
    // C3: keyed by line identity, so a reordered list has the same key (and resumes).
    expect(listKey(84532, parseRecipients(`${B},2\n${A},1`, 84532).recipients)).toBe(listKey(84532, lower));
  });

  it("C3: a line's identity is recipient (lower case) + amount + occurrence among identical lines", () => {
    expect(lineId(getAddress(A), 1_000_000n, 0)).toBe(`${A}:1000000:0`);
    expect(lineId(getAddress(A), 1_000_000n, 1)).toBe(`${A}:1000000:1`);
    const r = parseRecipients(`${B},2\n${A},1`, 84532).recipients;
    expect(r.map((x) => x.id)).toEqual([`${B}:2000000:0`, `${A}:1000000:0`]);
  });
});

describe("fragment #envio=", () => {
  it("round-trips UTF-8 lines as base64url", () => {
    const text = `${A},12,5\n${B};3 # café`;
    const hash = encodeLines(text);
    expect(hash).toMatch(/^#envio=[A-Za-z0-9_-]+$/);
    expect(decodeLines(hash)).toBe(text);
    expect(decodeLines(hash.slice(1))).toBe(text);
  });

  it("anything else, malformed base64 or more than 4 KB is null", () => {
    expect(decodeLines("")).toBeNull();
    expect(decodeLines("#gastos=abc")).toBeNull();
    expect(decodeLines("#envio=%%%")).toBeNull();
    expect(decodeLines(`#envio=${"A".repeat(5000)}`)).toBeNull();
    expect(() => encodeLines("x".repeat(5000))).toThrow();
  });
});
