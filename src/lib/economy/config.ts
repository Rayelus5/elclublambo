import "server-only";
import { cache } from "react";
import { isChainId, type ChainId } from "@/lib/economy/networks";
import { createServerClient } from "@/lib/supabase/server";

export type ChainAddresses = { safe: string | null; platform: string | null };

export type EconomyConfig = {
  activeChainId: ChainId;
  minFeeBps: number;
  chains: Record<ChainId, ChainAddresses>;
};

type RawChain = { safe?: unknown; platform?: unknown } | undefined;

const addr = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);

/** economy_config() (any active member can read it). Cached per request. */
export const getEconomyConfig = cache(async (): Promise<EconomyConfig> => {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("economy_config");
  if (error) throw error;
  const raw = (data ?? {}) as { activeChainId?: unknown; minFeeBps?: unknown; chains?: Record<string, RawChain> };
  const active = Number(raw.activeChainId);
  const chain = (id: ChainId): ChainAddresses => ({
    safe: addr(raw.chains?.[String(id)]?.safe),
    platform: addr(raw.chains?.[String(id)]?.platform),
  });
  return {
    activeChainId: isChainId(active) ? active : 59141,
    minFeeBps: Number(raw.minFeeBps ?? 0),
    chains: { 59144: chain(59144), 59141: chain(59141) },
  };
});
