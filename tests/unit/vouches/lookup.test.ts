import { describe, expect, it } from "vitest";
import { parseVouchLookup } from "@/lib/vouches/lookup";

const ADDR = "0xAbCdEf0123456789abcdef0123456789ABCDEF01";

describe("parseVouchLookup", () => {
  it.each([
    ["", { kind: "empty" }],
    ["   ", { kind: "empty" }],
    [` ${ADDR} `, { kind: "address", address: ADDR }],
    ["0x12", { kind: "invalid" }],
    ["0xrayelus", { kind: "invalid" }],
    ["@Rayelus", { kind: "alias", alias: "rayelus" }],
    ["ray_elus", { kind: "alias", alias: "ray_elus" }],
    ["ab", { kind: "invalid" }],
    ["rayelus!", { kind: "invalid" }],
  ])("%j", (raw, expected) => {
    expect(parseVouchLookup(raw)).toEqual(expected);
  });
});
