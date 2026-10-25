import { renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.hoisted(() => ({ isConnected: true, status: "connected" as string, address: undefined as string | undefined }));
vi.mock("wagmi", () => ({ useAccount: () => account }));

import { canSignFor } from "@/lib/web3/can-sign";
import { useWalletMatch } from "@/lib/web3/use-wallet-match";
import { useSessionWalletMatch } from "@/lib/vouches/use-session-wallet";

const OWNER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x9999999999999999999999999999999999999999";
const upper = (a: string) => "0x" + a.slice(2).toUpperCase();

beforeEach(() => {
  account.isConnected = true;
  account.status = "connected";
  account.address = OWNER;
});

describe("canSignFor (Review Focus 2)", () => {
  it("the owner's own wallet, without a session, may sign", () => {
    expect(canSignFor(OWNER, OWNER, null)).toEqual({ ok: true });
  });
  it("the owner's wallet with the owner's session may sign, whatever the case", () => {
    expect(canSignFor(upper(OWNER), OWNER, upper(OWNER))).toEqual({ ok: true });
    expect(canSignFor(OWNER, upper(OWNER), OWNER)).toEqual({ ok: true });
  });
  it("another connected wallet is wrong_wallet", () => {
    expect(canSignFor(OWNER, OTHER, null)).toEqual({ ok: false, reason: "wrong_wallet" });
    expect(canSignFor(OWNER, OTHER, OWNER)).toEqual({ ok: false, reason: "wrong_wallet" });
  });
  it("the owner's wallet under another account's session is session_mismatch", () => {
    expect(canSignFor(OWNER, OWNER, OTHER)).toEqual({ ok: false, reason: "session_mismatch" });
  });
  it("no wallet connected is not_connected", () => {
    expect(canSignFor(OWNER, undefined, null)).toEqual({ ok: false, reason: "not_connected" });
    expect(canSignFor(OWNER, undefined, OWNER)).toEqual({ ok: false, reason: "not_connected" });
  });
});

describe("useWalletMatch", () => {
  it("matches the expected address in any case and returns the connected address", () => {
    account.address = upper(OWNER);
    expect(renderHook(() => useWalletMatch(OWNER)).result.current).toEqual({ address: upper(OWNER), matches: true, mismatch: false });
  });

  it("with no expected address, any connected wallet matches", () => {
    account.address = OTHER;
    expect(renderHook(() => useWalletMatch(null)).result.current).toEqual({ address: OTHER, matches: true, mismatch: false });
  });

  it("another account, or none connected, is a mismatch", () => {
    account.address = OTHER;
    expect(renderHook(() => useWalletMatch(OWNER)).result.current).toEqual({ address: OTHER, matches: false, mismatch: true });
    account.isConnected = false;
    account.address = undefined;
    account.status = "disconnected";
    expect(renderHook(() => useWalletMatch(OWNER)).result.current).toEqual({ address: undefined, matches: false, mismatch: true });
    expect(renderHook(() => useWalletMatch(null)).result.current).toEqual({ address: undefined, matches: false, mismatch: true });
  });

  it("while wagmi is reconnecting or connecting: no match, but no mismatch warning yet", () => {
    account.isConnected = false;
    account.address = undefined;
    for (const status of ["reconnecting", "connecting"]) {
      account.status = status;
      expect(renderHook(() => useWalletMatch(OWNER)).result.current).toEqual({ address: undefined, matches: false, mismatch: false });
    }
  });

  it("the server render (and so the hydration pass) is neutral even when connected", () => {
    function Probe() {
      return <output>{JSON.stringify(useWalletMatch(OWNER))}</output>;
    }
    expect(renderToString(<Probe />)).toContain(JSON.stringify({ matches: false, mismatch: false }).replace(/"/g, "&quot;"));
  });

  it("P5's useSessionWalletMatch is the same hook (without the address)", () => {
    expect(renderHook(() => useSessionWalletMatch(OWNER)).result.current).toEqual({ matches: true, mismatch: false });
    account.address = OTHER;
    expect(renderHook(() => useSessionWalletMatch(OWNER)).result.current).toEqual({ matches: false, mismatch: true });
  });
});
