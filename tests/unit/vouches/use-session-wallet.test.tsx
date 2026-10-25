import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.hoisted(() => ({ isConnected: true, status: "connected" as string, address: undefined as string | undefined }));
vi.mock("wagmi", () => ({ useAccount: () => account }));

import { useSessionWalletMatch } from "@/lib/vouches/use-session-wallet";

const ME = "0x1111111111111111111111111111111111111111";

beforeEach(() => {
  account.isConnected = true;
  account.status = "connected";
  account.address = ME;
});

describe("useSessionWalletMatch", () => {
  it("matches the session's wallet in any case", () => {
    account.address = ME.toUpperCase().replace("0X", "0x");
    expect(renderHook(() => useSessionWalletMatch(ME)).result.current).toEqual({ matches: true, mismatch: false });
  });

  it("another account, or none connected, is a mismatch", () => {
    account.address = "0x9999999999999999999999999999999999999999";
    expect(renderHook(() => useSessionWalletMatch(ME)).result.current).toEqual({ matches: false, mismatch: true });
    account.isConnected = false;
    account.address = undefined;
    account.status = "disconnected";
    expect(renderHook(() => useSessionWalletMatch(ME)).result.current).toEqual({ matches: false, mismatch: true });
  });

  it("while wagmi is still reconnecting: not a match, but no mismatch warning yet", () => {
    account.isConnected = false;
    account.address = undefined;
    account.status = "reconnecting";
    expect(renderHook(() => useSessionWalletMatch(ME)).result.current).toEqual({ matches: false, mismatch: false });
  });
});
