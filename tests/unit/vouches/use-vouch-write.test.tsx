import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const writeContractAsync = vi.fn();
vi.mock("wagmi", () => ({ useWriteContract: () => ({ writeContractAsync }) }));
const ensure = vi.fn<(chainId: number) => Promise<boolean>>();
let switching = false;
vi.mock("@/lib/payments/use-ensure-chain", () => ({ useEnsureChain: () => ({ ensure, switching, failedFor: null }) }));

import { attestArgs, EAS_ADDRESS, revokeArgs } from "@/lib/vouches/eas";
import { easAbi } from "@/lib/vouches/eas-abi";
import { useVouchWrite } from "@/lib/vouches/use-vouch-write";

const TO = "0x3333333333333333333333333333333333333333" as const;
const UID = `0x${"ab".repeat(32)}` as const;
const HASH = `0x${"cd".repeat(32)}` as const;
const ME = "0x1111111111111111111111111111111111111111" as const;
const SUFFIX = "0x62635f7465737407" + "00" + "80218021802180218021802180218021";

beforeEach(() => {
  writeContractAsync.mockReset().mockResolvedValue(HASH);
  ensure.mockReset().mockResolvedValue(true);
  switching = false;
  vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
  vi.stubEnv("NEXT_PUBLIC_BASE_BUILDER_CODE", "bc_test");
  vi.stubEnv("NEXT_PUBLIC_EAS_ADDRESS", "");
});

describe("useVouchWrite", () => {
  it("attest switches to Base first, then signs EAS attest with the builder suffix", async () => {
    const { result } = renderHook(() => useVouchWrite(ME));
    await expect(result.current.attest(TO, 2)).resolves.toBe(HASH);
    expect(ensure).toHaveBeenCalledWith(84532);
    expect(ensure.mock.invocationCallOrder[0]!).toBeLessThan(writeContractAsync.mock.invocationCallOrder[0]!);
    expect(writeContractAsync).toHaveBeenCalledWith({
      address: EAS_ADDRESS,
      abi: easAbi,
      functionName: "attest",
      args: attestArgs(TO, 2),
      chainId: 84532,
      account: ME,
      dataSuffix: SUFFIX,
    });
  });

  it("revoke signs EAS revoke on the vouch chain", async () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "mainnet");
    const { result } = renderHook(() => useVouchWrite(ME));
    await result.current.revoke(UID);
    expect(ensure).toHaveBeenCalledWith(8453);
    expect(writeContractAsync).toHaveBeenCalledWith({
      address: EAS_ADDRESS,
      abi: easAbi,
      functionName: "revoke",
      args: revokeArgs(UID),
      chainId: 8453,
      account: ME,
      dataSuffix: SUFFIX,
    });
  });

  it("no builder code, no dataSuffix", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_BUILDER_CODE", "");
    const { result } = renderHook(() => useVouchWrite(ME));
    await result.current.attest(TO, 1);
    expect(writeContractAsync.mock.calls[0]![0]).not.toHaveProperty("dataSuffix");
  });

  it("does not sign when the chain switch fails", async () => {
    ensure.mockResolvedValue(false);
    const { result } = renderHook(() => useVouchWrite(ME));
    await expect(result.current.attest(TO, 1)).rejects.toThrow("chain_switch_failed");
    await expect(result.current.revoke(UID)).rejects.toThrow("chain_switch_failed");
    expect(writeContractAsync).not.toHaveBeenCalled();
  });

  it("uses the testnet EAS override and exposes switching", async () => {
    switching = true;
    vi.stubEnv("NEXT_PUBLIC_EAS_ADDRESS", "0x1111111111111111111111111111111111111111");
    const { result } = renderHook(() => useVouchWrite(ME));
    expect(result.current.switching).toBe(true);
    await expect(result.current.attest(TO, 1)).resolves.toBe(HASH);
    expect(writeContractAsync.mock.calls[0]![0].address).toBe("0x1111111111111111111111111111111111111111");
  });
});
