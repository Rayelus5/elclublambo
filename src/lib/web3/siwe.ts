import type { Address } from "viem";
import { createSiweMessage, generateSiweNonce } from "viem/siwe";
import { appChainIds } from "@/lib/economy/networks";

export const LOGIN_STATEMENT =
  "Entra en El Club Lambo. Esta firma no cuesta gas ni mueve fondos.";

const VALIDITY_MS = 5 * 60 * 1000;

export type LoginMessageParams = {
  address: Address;
  chainId: number;
  nonce: string;
  domain: string;
  uri: string;
  now?: Date;
};

export function buildLoginMessage(p: LoginMessageParams): string {
  // Login works on any of the build's chains (D5): the wallet signs on whichever it is connected to.
  if (!(appChainIds() as number[]).includes(p.chainId)) {
    throw new Error("invalid_input");
  }
  const now = p.now ?? new Date();
  return createSiweMessage({
    address: p.address,
    chainId: p.chainId,
    domain: p.domain,
    uri: p.uri,
    nonce: p.nonce,
    version: "1",
    statement: LOGIN_STATEMENT,
    issuedAt: now,
    notBefore: now,
    expirationTime: new Date(now.getTime() + VALIDITY_MS),
  });
}

export function generateNonce(): string {
  return generateSiweNonce();
}
