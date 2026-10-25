import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { ChainId } from "@/lib/economy/networks";
import { inspectTransfer, type InspectResult } from "./inspect";
import { readFinal, receiptKey, takeStashed } from "./receipt-cache";

/**
 * The receipt's data (P3-R2, stateless). The cached read goes first: a final payment already seen costs no RPC call.
 * When the payment is not final (pending, not yet confirmed, or an error), readFinal stores nothing and hands back the
 * inspection it just made, so that view still costs a single inspection. The hash is lowercased so a transaction has a
 * single cache entry. If the hand-back is missing (two concurrent views of the same hash, one of them took it), one
 * fresh uncached inspection answers instead of a false «could not read the chain».
 */
export async function readReceipt(chain: ChainId, hash: `0x${string}`): Promise<InspectResult> {
  const h = hash.toLowerCase() as `0x${string}`;
  const key = receiptKey(chain, h);
  try {
    return await readFinal(chain, h);
  } catch (e) {
    unstable_rethrow(e);
    return takeStashed(key) ?? (await inspectTransfer(chain, h));
  }
}
