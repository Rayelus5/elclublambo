import { vi } from "vitest";

/**
 * A fake x402 facilitator for the API tests: no network. `getSupported` answers Base Sepolia «exact», `verify` accepts
 * every payment, `settle` succeeds. The spies are shared by every client the code builds.
 */
export const facilitator = {
  constructed: vi.fn(),
  getSupported: vi.fn(),
  verify: vi.fn(),
  settle: vi.fn(),
};

export const PAYER = "0x2222222222222222222222222222222222222222";

export function resetFacilitator() {
  facilitator.constructed.mockReset();
  facilitator.getSupported.mockReset().mockResolvedValue({
    kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }],
    extensions: [],
    signers: {},
  });
  facilitator.verify.mockReset().mockResolvedValue({ isValid: true, payer: PAYER });
  facilitator.settle.mockReset().mockResolvedValue({ success: true, transaction: `0x${"ab".repeat(32)}`, network: "eip155:84532", payer: PAYER });
}

export class FakeFacilitatorClient {
  constructor(config?: unknown) {
    facilitator.constructed(config);
  }
  getSupported() {
    return facilitator.getSupported();
  }
  verify(payload: unknown, requirements: unknown) {
    return facilitator.verify(payload, requirements);
  }
  settle(payload: unknown, requirements: unknown) {
    return facilitator.settle(payload, requirements);
  }
}

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");
export const decode = (h: string | null) => JSON.parse(Buffer.from(h ?? "", "base64").toString("utf8"));

/** A PAYMENT-SIGNATURE for the first option of a decoded PAYMENT-REQUIRED (the fake facilitator accepts any signature). */
export function paymentSignature(paymentRequired: { resource: unknown; accepts: { payTo: string; amount: string }[] }): string {
  const [accepted] = paymentRequired.accepts;
  if (!accepted) throw new Error("no payment option");
  return b64({
    x402Version: 2,
    resource: paymentRequired.resource,
    accepted,
    payload: {
      signature: `0x${"11".repeat(65)}`,
      authorization: {
        from: PAYER,
        to: accepted.payTo,
        value: accepted.amount,
        validAfter: "0",
        validBefore: String(Math.floor(Date.now() / 1000) + 600),
        nonce: `0x${"33".repeat(32)}`,
      },
    },
  });
}
