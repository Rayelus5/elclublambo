// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const headersFn = vi.hoisted(() => vi.fn(async () => new Headers({ "x-forwarded-for": "203.0.113.7" })));
vi.mock("next/headers", () => ({ headers: headersFn }));
const hitIpRateLimit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit/ip", () => ({ hitIpRateLimit }));
const checkAllowance = vi.hoisted(() => vi.fn());
vi.mock("@/lib/approvals/read", () => ({ checkAllowance }));
const getPublicSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/public-session", () => ({ getPublicSession }));

import { checkAllowanceAction } from "@/lib/approvals/actions";
import type { ApprovalRow } from "@/lib/approvals/types";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const TOKEN = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const SPENDER = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const input = { chain: "base" as const, owner: OWNER, token: TOKEN, spender: SPENDER };
const row: ApprovalRow = {
  token: TOKEN,
  symbol: "USDC",
  decimals: 6,
  spender: SPENDER,
  spenderLabel: "Permit2",
  spenderKind: "known",
  allowance: "5000000",
  unlimited: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
  hitIpRateLimit.mockResolvedValue("ok");
  checkAllowance.mockResolvedValue(row);
});

describe("checkAllowanceAction", () => {
  it("a malformed address or chain: invalid_input, without charging the limiter or reading the chain", async () => {
    await expect(checkAllowanceAction({ ...input, token: "0x12" })).resolves.toEqual({ ok: false, error: "invalid_input" });
    await expect(checkAllowanceAction({ ...input, owner: "nadie" })).resolves.toEqual({ ok: false, error: "invalid_input" });
    await expect(checkAllowanceAction({ ...input, chain: "polygon" as "base" })).resolves.toEqual({ ok: false, error: "invalid_input" });
    expect(hitIpRateLimit).not.toHaveBeenCalled();
    expect(checkAllowance).not.toHaveBeenCalled();
  });

  it("charges one hit of approvals_scan to the caller's IP, then reads on the build's chain (no session needed)", async () => {
    await expect(checkAllowanceAction(input)).resolves.toEqual({ ok: true, row });
    expect(hitIpRateLimit).toHaveBeenCalledWith("approvals_scan", expect.any(Headers));
    expect(checkAllowance).toHaveBeenCalledWith(84532, OWNER, TOKEN, SPENDER);
    expect(getPublicSession).not.toHaveBeenCalled();
    await checkAllowanceAction({ ...input, chain: "arbitrum" });
    expect(checkAllowance).toHaveBeenLastCalledWith(421614, OWNER, TOKEN, SPENDER);
  });

  it("rate_limited: the chain is not read", async () => {
    hitIpRateLimit.mockResolvedValue("rate_limited");
    await expect(checkAllowanceAction(input)).resolves.toEqual({ ok: false, error: "rate_limited" });
    expect(checkAllowance).not.toHaveBeenCalled();
  });

  it("a limiter error lets the check through (as the checker page)", async () => {
    hitIpRateLimit.mockResolvedValue("error");
    await expect(checkAllowanceAction(input)).resolves.toEqual({ ok: true, row });
    expect(checkAllowance).toHaveBeenCalled();
  });

  it("an allowance of 0 is row: null; library errors pass through", async () => {
    checkAllowance.mockResolvedValue({ allowance: "0" });
    await expect(checkAllowanceAction(input)).resolves.toEqual({ ok: true, row: null });
    checkAllowance.mockResolvedValue({ error: "not_a_token" });
    await expect(checkAllowanceAction(input)).resolves.toEqual({ ok: false, error: "not_a_token" });
    checkAllowance.mockResolvedValue({ error: "rpc_unavailable" });
    await expect(checkAllowanceAction(input)).resolves.toEqual({ ok: false, error: "rpc_unavailable" });
  });
});
