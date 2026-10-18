import "server-only";
import type { Address } from "viem";
import type { ChainId } from "@/lib/economy/networks";
import { createAdminClient } from "@/lib/supabase/admin";
import { assetsUsd6, readEthPrice, readSafeAssets, type EthPrice, type SafeAssets } from "@/lib/treasury/valuation";

export type SafeValuation = {
  /** usdc + floor((eth + weth) · priceE8 / 10^20), exactly the composition `record_nav_snapshot` checks. */
  assetsUsd6: bigint;
  priceE8: bigint;
  source: EthPrice["source"];
  assets: SafeAssets;
  /** The block every balance was read at (credit_donation's p_assets_block, ruling F4a-R4). */
  blockNumber: bigint;
  /** The Safe whose balances these are; the SQL writers refuse it (safe_changed) if chain_config moved meanwhile. */
  safe: Address;
};

type Db = ReturnType<typeof createAdminClient>;

/** The chain's Safe from chain_config, or null when unset. Throws on a read error. */
export async function safeAddressOf(db: Db, chain: ChainId): Promise<Address | null> {
  const { data, error } = await db.from("chain_config").select("safe_address").eq("chain_id", chain).maybeSingle<{ safe_address: string | null }>();
  if (error) throw new Error(`chain_config read failed: ${error.message}`);
  return (data?.safe_address as Address | null | undefined) ?? null;
}

async function lastPriceE8(db: Db, chain: ChainId): Promise<bigint | null> {
  const { data, error } = await db
    .from("dao_nav_snapshots")
    .select("eth_price_e8:eth_price_e8::text")
    .eq("chain_id", chain)
    .order("taken_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ eth_price_e8: string }>();
  if (error) throw new Error(`dao_nav_snapshots read failed: ${error.message}`);
  return data ? BigInt(data.eth_price_e8) : null;
}

/**
 * The Safe's market value right now: balances read at one block, ETH at Chainlink (or a sane CoinGecko price checked
 * against the last snapshot). Null when the Safe is unset, a chain read fails or there is no price: callers wait,
 * nothing is defaulted. Database read errors throw (an operator signal: the cron reports the step as failed).
 */
export async function valueSafe(chain: ChainId): Promise<SafeValuation | null> {
  const db = createAdminClient();
  const safe = await safeAddressOf(db, chain);
  if (!safe) return null;
  const last = await lastPriceE8(db, chain);
  try {
    const [assets, price] = await Promise.all([readSafeAssets(chain, safe), readEthPrice(chain, { lastPriceE8: last })]);
    if (!price) return null;
    return {
      assetsUsd6: assetsUsd6(assets, price.priceE8),
      priceE8: price.priceE8,
      source: price.source,
      assets,
      blockNumber: assets.blockNumber,
      safe,
    };
  } catch (e) {
    console.error("[treasury] valuation failed", chain, e instanceof Error ? e.message : e);
    return null;
  }
}

/** Records an hourly NAV snapshot (the RPC throttles to one per 55 minutes). A failed valuation skips it. */
export async function takeSnapshot(chain: ChainId): Promise<"taken" | "skipped" | "unavailable"> {
  const v = await valueSafe(chain);
  if (!v) return "unavailable";
  const { data, error } = await createAdminClient().rpc("record_nav_snapshot", {
    p_chain: chain,
    p_safe: v.safe,
    p_snapshot: {
      usdcUnits: v.assets.usdc.toString(),
      ethWei: v.assets.eth.toString(),
      wethWei: v.assets.weth.toString(),
      ethPriceE8: v.priceE8.toString(),
      priceSource: v.source,
      blockNumber: v.blockNumber.toString(),
      assetsUsd6: v.assetsUsd6.toString(),
    },
  });
  if (error) throw new Error(`record_nav_snapshot failed: ${error.message}`);
  return (data as { skipped?: unknown } | null)?.skipped === true ? "skipped" : "taken";
}
