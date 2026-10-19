import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getBalance = vi.hoisted(() => vi.fn());
const readContract = vi.hoisted(() => vi.fn());
const useBalance = vi.hoisted(() => vi.fn());
const useReadContract = vi.hoisted(() => vi.fn());
vi.mock("wagmi", () => ({ useConfig: () => ({ fake: true }), useBalance, useReadContract }));
vi.mock("wagmi/actions", () => ({ getBalance, readContract }));

import { formBalanceError, preflightShortfall, useBalancePreflight, useWalletBalances } from "@/lib/payments/preflight";

const U = 1_000_000n;
const E = 10n ** 18n;
const base = { chain: 59144 as const, mainLabel: "donación", feePaid: false };

describe("preflightShortfall", () => {
  it("lets a USDC payment through when the balance covers fee + main and there is ETH for gas", () => {
    expect(preflightShortfall({ ...base, token: "USDC", feeAmount: 50_000n, mainAmount: 10n * U, usdc: 11n * U, eth: 1n })).toBeNull();
  });

  it("refuses when USDC covers the fee but not fee + main, saying nothing was sent", () => {
    const msg = preflightShortfall({ ...base, token: "USDC", feeAmount: 250_000n, mainAmount: 10n * U, usdc: 9_800_000n, eth: E });
    expect(msg).toBe("No tienes suficiente USDC en Linea: necesitas 10,25 USDC (donación + comisión) y tienes 9,8. No se ha enviado nada.");
  });

  it("refuses a USDC payment with no ETH for gas", () => {
    expect(preflightShortfall({ ...base, token: "USDC", feeAmount: 0n, mainAmount: U, usdc: 5n * U, eth: 0n })).toBe(
      "Necesitas algo de ETH en Linea para pagar el gas.",
    );
  });

  it("refuses an ETH tip when ETH does not exceed fee + main", () => {
    const msg = preflightShortfall({ ...base, mainLabel: "propina", token: "ETH", feeAmount: E / 100n, mainAmount: E, usdc: 0n, eth: E });
    expect(msg).toMatch(/^No tienes suficiente ETH en Linea: necesitas 1,01 ETH \(propina \+ comisión\) y tienes 1\. No se ha enviado nada\.$/);
  });

  it("lets an ETH tip through with a margin", () => {
    expect(preflightShortfall({ ...base, token: "ETH", feeAmount: E / 100n, mainAmount: E, usdc: 0n, eth: 2n * E })).toBeNull();
  });

  it("omits the fee wording when there is no fee", () => {
    const msg = preflightShortfall({ ...base, token: "USDC", feeAmount: 0n, mainAmount: 10n * U, usdc: 9n * U, eth: E });
    expect(msg).toBe("No tienes suficiente USDC en Linea: necesitas 10 USDC y tienes 9. No se ha enviado nada.");
  });

  it("on resume only the main amount is required and the message says the fee is paid", () => {
    const msg = preflightShortfall({ ...base, token: "USDC", feeAmount: 250_000n, mainAmount: 10n * U, usdc: 9n * U, eth: E, feePaid: true });
    expect(msg).toContain("necesitas 10 USDC para la donación y tienes 9");
    expect(msg).toContain("La comisión ya está pagada");
    expect(msg).toContain("Firmar");
  });

  it("on resume passes when the balance covers just the main amount", () => {
    expect(preflightShortfall({ ...base, token: "USDC", feeAmount: 250_000n, mainAmount: 10n * U, usdc: 10n * U, eth: 1n, feePaid: true })).toBeNull();
  });
});

describe("useBalancePreflight", () => {
  beforeEach(() => {
    getBalance.mockReset().mockResolvedValue({ value: E });
    readContract.mockReset().mockResolvedValue(20n * U);
  });
  const acct = "0x1111111111111111111111111111111111111111" as const;
  const args = { chain: 59144 as const, token: "USDC" as const, account: acct, feeAmount: 100_000n, mainAmount: 10n * U, feePaid: false, mainLabel: "donación" };

  it("reads both balances on the intent's chain and returns null when enough", async () => {
    const { result } = renderHook(() => useBalancePreflight());
    expect(await result.current(args)).toBeNull();
    expect(getBalance).toHaveBeenCalledWith({ fake: true }, { address: acct, chainId: 59144 });
    expect(readContract).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ functionName: "balanceOf", args: [acct], chainId: 59144 }));
  });

  it("returns the shortfall message when short", async () => {
    readContract.mockResolvedValue(5n * U);
    const { result } = renderHook(() => useBalancePreflight());
    expect(await result.current(args)).toMatch(/No tienes suficiente USDC/);
  });

  it("does not block when the balance read fails", async () => {
    readContract.mockRejectedValue(new Error("rpc down"));
    const { result } = renderHook(() => useBalancePreflight());
    expect(await result.current(args)).toBeNull();
  });
});

describe("useWalletBalances", () => {
  const acct = "0x1111111111111111111111111111111111111111" as const;
  it("reads ETH and USDC on the given chain and exposes them", () => {
    useBalance.mockReturnValue({ data: { value: E } });
    useReadContract.mockReturnValue({ data: 3n * U });
    const { result } = renderHook(() => useWalletBalances(59144, acct));
    expect(result.current.eth).toBe(E);
    expect(result.current.usdc).toBe(3n * U);
    expect(useBalance).toHaveBeenCalledWith(expect.objectContaining({ address: acct, chainId: 59144 }));
    expect(useReadContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "balanceOf", args: [acct], chainId: 59144 }));
  });

  it("gives null when a balance is unreadable", () => {
    useBalance.mockReturnValue({ data: undefined });
    useReadContract.mockReturnValue({ data: undefined });
    const { result } = renderHook(() => useWalletBalances(59144, acct));
    expect(result.current.eth).toBeNull();
    expect(result.current.usdc).toBeNull();
  });
});

describe("formBalanceError", () => {
  const f = { chain: 59144 as const, token: "USDC" as const, amount: 10n * U, fee: 50_000n, eth: E };
  it("says how much is needed and held when amount + fee exceeds the balance", () => {
    expect(formBalanceError({ ...f, balance: 9_800_000n })).toBe("Saldo insuficiente: necesitas 10,05 USDC (importe + comisión) y tienes 9,8.");
  });
  it("asks for ETH for gas on a USDC payment with no ETH", () => {
    expect(formBalanceError({ ...f, balance: 20n * U, eth: 0n })).toBe("Necesitas algo de ETH en Linea para el gas.");
  });
  it("omits the fee wording when there is no fee", () => {
    expect(formBalanceError({ ...f, fee: 0n, balance: 9_800_000n })).toBe("Saldo insuficiente: necesitas 10 USDC y tienes 9,8.");
  });
  it("ETH token: refuses when the balance does not exceed amount + fee (gas margin)", () => {
    const eth = { chain: 59144 as const, token: "ETH" as const, amount: E, fee: E / 100n, eth: 0n };
    expect(formBalanceError({ ...eth, balance: E })).toBe("Saldo insuficiente: necesitas 1,01 ETH (importe + comisión) y tienes 1.");
    expect(formBalanceError({ ...eth, balance: E + E / 100n })).toMatch(/^Saldo insuficiente/);
    expect(formBalanceError({ ...eth, balance: 2n * E })).toBeNull();
  });
  it("is null when covered", () => {
    expect(formBalanceError({ ...f, balance: 10_050_000n })).toBeNull();
  });
});
