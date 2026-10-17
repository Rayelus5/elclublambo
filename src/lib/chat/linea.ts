import "server-only";
import { createPublicClient, http } from "viem";
import { linea } from "viem/chains";
import { ALPHA_ADDRESS_RE } from "@/lib/chat/model";

/**
 * True when the address holds bytecode on Linea mainnet (59144). Throws `Error("network")` when the chain cannot be
 * queried, so the caller can tell "not a contract" from "could not check".
 * `LINEA_RPC_URL` overrides the chain's public RPC (rate-limited; set a dedicated one in production).
 */
export async function verifyLineaContract(address: string): Promise<boolean> {
  if (!ALPHA_ADDRESS_RE.test(address)) return false;
  const client = createPublicClient({
    chain: linea,
    transport: http(process.env.LINEA_RPC_URL || undefined, { timeout: 8000, retryCount: 1 }),
  });
  let code: string | undefined;
  try {
    code = await client.getCode({ address: address as `0x${string}` });
  } catch {
    throw new Error("network");
  }
  return typeof code === "string" && code !== "0x" && code.length > 2;
}
