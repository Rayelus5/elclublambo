"use server";

import { revalidatePath } from "next/cache";
import { rpcErrorCode } from "@/lib/errors";
import { isChainId, MAX_FEE_BPS } from "@/lib/economy/networks";
import { createServerClient } from "@/lib/supabase/server";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Empty clears the address (null); a malformed one is rejected here and again by the RPC. */
function cleanAddress(v: unknown): string | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (t === "") return null;
  return ADDRESS_RE.test(t) ? t : undefined;
}

export async function setActiveChainAction(chain: number): Promise<{ error?: string }> {
  if (!isChainId(chain)) return { error: "chain_invalid" };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("set_active_chain", { p_chain: chain });
  if (error) return { error: rpcErrorCode(error) };
  revalidatePath("/", "layout");
  return {};
}

export async function setMinFeeBpsAction(bps: number): Promise<{ error?: string }> {
  if (!Number.isInteger(bps) || bps < 0 || bps > MAX_FEE_BPS) return { error: "fee_out_of_range" };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("set_min_fee_bps", { p_bps: bps });
  if (error) return { error: rpcErrorCode(error) };
  revalidatePath("/", "layout");
  return {};
}

/** The RPC replaces BOTH addresses, so callers always pass both (null clears one). */
export async function setChainAddressesAction(input: {
  chain: number;
  safe: string | null;
  platform: string | null;
}): Promise<{ error?: string }> {
  if (!isChainId(input.chain)) return { error: "chain_invalid" };
  const safe = cleanAddress(input.safe);
  const platform = cleanAddress(input.platform);
  if (safe === undefined || platform === undefined) return { error: "address_invalid" };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("set_chain_addresses", {
    p_chain: input.chain,
    p_safe: safe,
    p_platform: platform,
  });
  if (error) return { error: rpcErrorCode(error) };
  revalidatePath("/", "layout");
  return {};
}
