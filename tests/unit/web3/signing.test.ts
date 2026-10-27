import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAIN_SWITCH_FAILED,
  clearSent,
  isSentFresh,
  NOT_FOUND_GIVE_UP_MS,
  parseSent,
  readSentRaw,
  recordUntilSettled,
  sentAtNow,
  writeErrorKind,
  writeSent,
} from "@/lib/web3/signing";

const HASH = `0x${"cd".repeat(32)}` as const;

beforeEach(() => window.localStorage.clear());

describe("shared signing helpers", () => {
  it("classifies wallet write errors: switch, cancelled (code 4001 or name, also in cause), failed", () => {
    expect(CHAIN_SWITCH_FAILED).toBe("chain_switch_failed");
    expect(writeErrorKind(new Error(CHAIN_SWITCH_FAILED))).toBe("switch");
    expect(writeErrorKind({ code: 4001 })).toBe("cancelled");
    expect(writeErrorKind({ name: "X", cause: { name: "UserRejectedRequestError" } })).toBe("cancelled");
    expect(writeErrorKind(new Error("gas estimate failed"))).toBe("failed");
  });

  it("recordUntilSettled retries while pending, stops on an answer, and gives up as pending", async () => {
    const record = vi.fn().mockResolvedValueOnce({ ok: false, error: "pending" }).mockResolvedValueOnce({ ok: true, uid: "u" });
    await expect(recordUntilSettled(record, [0, 0], () => true)).resolves.toEqual({ ok: true, uid: "u" });
    expect(record).toHaveBeenCalledTimes(2);
    const always = vi.fn().mockResolvedValue({ ok: false, error: "pending" });
    await expect(recordUntilSettled(always, [0, 0], () => true)).resolves.toBe("pending");
    expect(always).toHaveBeenCalledTimes(3);
    await expect(recordUntilSettled(always, [0], () => false)).resolves.toBeNull();
  });

  it("stores a sent hash with sentAt; parse rejects anything else; clear removes it", () => {
    writeSent("k", { hash: HASH, sentAt: 5 });
    expect(parseSent(readSentRaw("k"))).toEqual({ hash: HASH, sentAt: 5 });
    expect(parseSent('{"hash":"0x12","sentAt":1}')).toBeNull();
    expect(parseSent("not json")).toBeNull();
    clearSent("k");
    expect(readSentRaw("k")).toBeNull();
  });

  it("isSentFresh: younger than the give-up window, at the time asked", () => {
    const now = sentAtNow();
    expect(isSentFresh({ hash: HASH, sentAt: now }, now)).toBe(true);
    expect(isSentFresh({ hash: HASH, sentAt: now - NOT_FOUND_GIVE_UP_MS }, now)).toBe(false);
    expect(NOT_FOUND_GIVE_UP_MS).toBe(10 * 60_000);
  });
});
