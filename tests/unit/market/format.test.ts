import { describe, expect, it } from "vitest";
import { formatChange, formatCompactUsd, formatPrice, formatTime } from "@/lib/market/format";

// Pinned against Node 24 / ICU es-ES. Note es-ES drops the thousands separator on 4-digit numbers ("1234,50").
describe("formatPrice", () => {
  it("two decimals from 1 USD up, rounded half-expand by Intl", () => {
    expect(formatPrice(64321.456)).toBe("64.321,46 USD");
    expect(formatPrice(1234.5)).toBe("1234,50 USD");
    expect(formatPrice(1)).toBe("1,00 USD");
  });
  it("up to 6 significant digits under 1 USD", () => {
    expect(formatPrice(0.000012345)).toBe("0,000012345 USD");
    expect(formatPrice(0.123456789)).toBe("0,123457 USD");
    expect(formatPrice(0.5)).toBe("0,5 USD");
  });
  it("null or non-finite is a dash", () => {
    expect(formatPrice(null)).toBe("—");
    expect(formatPrice(Number.NaN)).toBe("—");
  });
});

describe("formatCompactUsd", () => {
  it("compact es-ES short scale, then USD", () => {
    // ICU puts a NO-BREAK SPACE (U+00A0) between the number and the suffix; the " USD" joiner is a plain space.
    expect(formatCompactUsd(1.23e12)).toBe("1,23 B USD");
    expect(formatCompactUsd(1234567)).toBe("1,23 M USD");
    expect(formatCompactUsd(5.4e9)).toBe("5400 M USD");
    expect(formatCompactUsd(999)).toBe("999 USD");
  });
  it("null is a dash", () => {
    expect(formatCompactUsd(null)).toBe("—");
  });
});

describe("formatChange", () => {
  it("signs and direction", () => {
    expect(formatChange(2.345)).toEqual({ text: "+2,35 %", dir: "up" });
    expect(formatChange(-0.5)).toEqual({ text: "-0,50 %", dir: "down" });
    expect(formatChange(0)).toEqual({ text: "0,00 %", dir: "flat" });
  });
  it("a change that rounds to zero is flat, not signed", () => {
    expect(formatChange(-0.001)).toEqual({ text: "0,00 %", dir: "flat" });
  });
  it("null is a dash, flat", () => {
    expect(formatChange(null)).toEqual({ text: "—", dir: "flat" });
  });
});

describe("formatTime", () => {
  it("HH:MM, es-ES", () => {
    expect(formatTime("2026-10-18T10:05:00.000Z")).toMatch(/^\d{2}:\d{2}$/);
  });
});
