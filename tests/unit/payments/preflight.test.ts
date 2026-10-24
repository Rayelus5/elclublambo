import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const readAssetBalance = vi.hoisted(() => vi.fn());
vi.mock("wagmi", () => ({ useConfig: () => ({ fake: true }) }));
vi.mock("@/lib/payments/balances", () => ({ readAssetBalance }));

import { formBalanceError, preflightShortfall, useBalancePreflight } from "@/lib/payments/preflight";

const U = 1_000_000n;
const E = 10n ** 18n;
const base = { chain: 84532 as const, mainLabel: "la propina" };

describe("preflightShortfall", () => {
  it("lets a USDC payment through when the balance covers the amount and there is ETH for gas", () => {
    expect(preflightShortfall({ ...base, token: "USDC", amount: 10n * U, usdc: 10n * U, eth: 1n })).toBeNull();
  });

  it("refuses a USDC payment the balance does not cover, saying nothing was sent", () => {
    expect(preflightShortfall({ ...base, token: "USDC", amount: 10n * U, usdc: 9n * U, eth: E })).toBe(
      "No tienes suficiente USDC en Base Sepolia para la propina: necesitas 10 USDC y tienes 9. No se ha enviado nada.",
    );
  });

  it("asks for ETH for gas when USDC is enough but there is no ETH", () => {
    expect(preflightShortfall({ ...base, token: "USDC", amount: U, usdc: 5n * U, eth: 0n })).toBe("Necesitas algo de ETH en Base Sepolia para pagar el gas.");
  });

  it("refuses an ETH payment when ETH does not exceed the amount (gas margin)", () => {
    expect(preflightShortfall({ ...base, mainLabel: "el pago", token: "ETH", amount: E, usdc: 0n, eth: E })).toBe(
      "No tienes suficiente ETH en Base Sepolia para el pago: necesitas 1 ETH y tienes 1. No se ha enviado nada.",
    );
    expect(preflightShortfall({ ...base, token: "ETH", amount: E, usdc: 0n, eth: 2n * E })).toBeNull();
  });

  it("names the payment's network", () => {
    expect(preflightShortfall({ ...base, chain: 421614, token: "USDC", amount: U, usdc: U, eth: 0n })).toBe("Necesitas algo de ETH en Arbitrum Sepolia para pagar el gas.");
  });
});

describe("useBalancePreflight", () => {
  const acct = "0x1111111111111111111111111111111111111111" as const;
  const args = { chain: 421614 as const, token: "USDC" as const, account: acct, amount: 10n * U, mainLabel: "la propina" };
  beforeEach(() => {
    readAssetBalance.mockReset().mockImplementation(async (_c: unknown, a: { token: string }) => (a.token === "ETH" ? E : 20n * U));
  });

  it("reads the token and the chain's ETH through readAssetBalance on the payment's chain", async () => {
    const { result } = renderHook(() => useBalancePreflight());
    expect(await result.current(args)).toBeNull();
    const ids = readAssetBalance.mock.calls.map((c) => (c[1] as { id: string }).id).sort();
    expect(ids).toEqual(["ETH:421614", "USDC:421614"]);
    expect(readAssetBalance.mock.calls.every((c) => (c[0] as { fake?: boolean }).fake === true && c[2] === acct)).toBe(true);
  });

  it("reads ETH once for an ETH payment", async () => {
    const { result } = renderHook(() => useBalancePreflight());
    expect(await result.current({ ...args, token: "ETH", amount: E / 2n })).toBeNull();
    expect(readAssetBalance.mock.calls.map((c) => (c[1] as { id: string }).id)).toEqual(["ETH:421614"]);
  });

  it("returns the shortfall message when short", async () => {
    readAssetBalance.mockImplementation(async (_c: unknown, a: { token: string }) => (a.token === "ETH" ? E : 5n * U));
    const { result } = renderHook(() => useBalancePreflight());
    expect(await result.current(args)).toMatch(/No tienes suficiente USDC en Arbitrum Sepolia/);
  });

  it("does not block when a balance read fails", async () => {
    readAssetBalance.mockRejectedValue(new Error("rpc down"));
    const { result } = renderHook(() => useBalancePreflight());
    expect(await result.current(args)).toBeNull();
  });
});

describe("formBalanceError", () => {
  const f = { chain: 84532 as const, token: "USDC" as const, amount: 10n * U, eth: E };
  it("says how much is needed and held when the amount exceeds the balance", () => {
    expect(formBalanceError({ ...f, balance: 9_800_000n })).toBe("Saldo insuficiente: necesitas 10 USDC y tienes 9,8.");
  });
  it("asks for ETH for gas on a USDC payment with no ETH", () => {
    expect(formBalanceError({ ...f, balance: 20n * U, eth: 0n })).toBe("Necesitas algo de ETH en Base Sepolia para el gas.");
  });
  it("ETH token: refuses when the balance does not exceed the amount (gas margin)", () => {
    const eth = { chain: 84532 as const, token: "ETH" as const, amount: E, eth: 0n };
    expect(formBalanceError({ ...eth, balance: E })).toBe("Saldo insuficiente: necesitas 1 ETH y tienes 1.");
    expect(formBalanceError({ ...eth, balance: 2n * E })).toBeNull();
  });
  it("is null when covered", () => {
    expect(formBalanceError({ ...f, balance: 10n * U })).toBeNull();
  });
});
