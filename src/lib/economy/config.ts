import "server-only";
import { cache } from "react";
import { appChainIds, chainForKey, type ChainId } from "@/lib/economy/networks";
import { isLegacyChainId, type LegacyChainId } from "@/lib/legacy/linea";
import { createServerClient } from "@/lib/supabase/server";

export type ChainAddresses = { safe: string | null; platform: string | null };

/** The legacy islands' settings (DAO, raffles; P0-R2), read from chain_config and active_chain_id until P1. */
export type LegacyEconomyConfig = {
  activeChainId: LegacyChainId;
  /** chain_config.withdrawals_enabled per network (SuperAdmin's switch). */
  withdrawalsEnabled: Record<LegacyChainId, boolean>;
  /** chain_config.weighted_raffles_enabled per network (SuperAdmin's switch; gates creating weighted raffles only). */
  weightedRafflesEnabled: Record<LegacyChainId, boolean>;
  chains: Record<LegacyChainId, ChainAddresses>;
};

export type EconomyConfig = {
  /** Enabled in the DB and in the build's set (P0-R1), in appChainIds() order. */
  enabledChainIds: ChainId[];
  /** The club Safe per network as stored; not checked on-chain yet (getCode, D6 in P1). */
  safes: Partial<Record<ChainId, string>>;
  /** app_config.legacy_dao_enabled: the legacy DAO's on-chain part runs only when exactly true. */
  legacyDaoEnabled: boolean;
  legacy: LegacyEconomyConfig;
};

type RawChain = { safe?: unknown; platform?: unknown; withdrawalsEnabled?: unknown; weightedRafflesEnabled?: unknown } | undefined;
type Raw = {
  activeChainId?: unknown;
  chains?: Record<string, RawChain>;
  enabledChainIds?: unknown;
  networks?: Record<string, { enabled?: unknown; safe?: unknown } | undefined>;
  legacyDaoEnabled?: unknown;
};

/** The network shown first: the first enabled one, or the build's Base when none is enabled. */
export function primaryChainId(config: Pick<EconomyConfig, "enabledChainIds">): ChainId {
  return config.enabledChainIds[0] ?? chainForKey("base");
}

const addr = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);

/** economy_config() (any active member can read it). Cached per request. */
export const getEconomyConfig = cache(async (): Promise<EconomyConfig> => {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("economy_config");
  if (error) throw error;
  const raw = (data ?? {}) as Raw;

  const enabled = Array.isArray(raw.enabledChainIds) ? (raw.enabledChainIds as unknown[]) : [];
  const enabledChainIds = appChainIds().filter((c) => enabled.includes(c));
  const safes: Partial<Record<ChainId, string>> = {};
  for (const c of appChainIds()) {
    const safe = addr(raw.networks?.[String(c)]?.safe);
    if (safe) safes[c] = safe;
  }

  const active = Number(raw.activeChainId);
  const chain = (id: LegacyChainId): ChainAddresses => ({
    safe: addr(raw.chains?.[String(id)]?.safe),
    platform: addr(raw.chains?.[String(id)]?.platform),
  });
  return {
    enabledChainIds,
    safes,
    legacyDaoEnabled: raw.legacyDaoEnabled === true,
    legacy: {
      activeChainId: isLegacyChainId(active) ? active : 59141,
      withdrawalsEnabled: {
        59144: raw.chains?.["59144"]?.withdrawalsEnabled === true,
        59141: raw.chains?.["59141"]?.withdrawalsEnabled === true,
      },
      weightedRafflesEnabled: {
        59144: raw.chains?.["59144"]?.weightedRafflesEnabled === true,
        59141: raw.chains?.["59141"]?.weightedRafflesEnabled === true,
      },
      chains: { 59144: chain(59144), 59141: chain(59141) },
    },
  };
});
