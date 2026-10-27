"use server";

import { clubPath } from "@/lib/club/paths";
import { revalidatePath } from "next/cache";
import { rpcErrorCode } from "@/lib/errors";
import { appChainIds, isChainId, type ChainId } from "@/lib/economy/networks";
import { createServerClient } from "@/lib/supabase/server";

/** SuperAdmin: enable or disable one network of this build (set_chain_enabled re-checks the permission and audits it). */
export async function setChainEnabledAction(
  chainId: ChainId,
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isChainId(chainId) || !appChainIds().includes(chainId) || typeof enabled !== "boolean") {
    return { ok: false, error: "invalid_input" };
  }
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("set_chain_enabled", { p_chain: chainId, p_enabled: enabled });
  if (error) return { ok: false, error: rpcErrorCode(error) };
  revalidatePath(clubPath(), "layout");
  return { ok: true };
}
