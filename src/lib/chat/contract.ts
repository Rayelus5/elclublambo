import "server-only";
import { chainClient } from "@/lib/payments/chain-client";
import type { ChainId } from "@/lib/economy/networks";

/**
 * True when the address holds bytecode on that chain. Throws `Error("network")` when the chain cannot be queried, so
 * the caller can tell "not a contract" from "could not check". The chain's RPC override env var (e.g.
 * `BASE_SEPOLIA_RPC_URL`) is read by `chainClient`.
 */
export async function verifyContract(chain: ChainId, address: `0x${string}`): Promise<boolean> {
  let code: string | undefined;
  try {
    code = await chainClient(chain).getCode({ address });
  } catch {
    throw new Error("network");
  }
  if (typeof code !== "string" || code.length <= 2) return false;
  // EIP-7702 delegation designator (0xef0100 || address): the account is an EOA, not a contract
  if (code.toLowerCase().startsWith("0xef0100")) return false;
  return true;
}
