import type { Address } from "viem";
import { createSiweMessage, generateSiweNonce } from "viem/siwe";
import { appChainIds } from "@/lib/economy/networks";

export const LOGIN_STATEMENT =
  "Entra en ElClub. Esta firma no cuesta gas ni mueve fondos.";

/** The sign-in phrase per language (the public side signs in the visitor's language; the club is Spanish-only). */
export const LOGIN_STATEMENTS: Record<"es" | "en", string> = {
  es: LOGIN_STATEMENT,
  en: "Sign in to ElClub. This signature costs no gas and moves no funds.",
};

const VALIDITY_MS = 5 * 60 * 1000;

export type LoginMessageParams = {
  address: Address;
  chainId: number;
  nonce: string;
  domain: string;
  uri: string;
  now?: Date;
  lang?: "es" | "en";
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
    statement: LOGIN_STATEMENTS[p.lang ?? "es"],
    issuedAt: now,
    notBefore: now,
    expirationTime: new Date(now.getTime() + VALIDITY_MS),
  });
}

export function generateNonce(): string {
  return generateSiweNonce();
}
