import type { AlertCode, AlertSeverity, TokenAlert, TokenFacts } from "./types";

/** P4-R2 thresholds. */
export const LOW_LIQUIDITY_USD = 10_000;
export const NEW_CONTRACT_DAYS = 7;

const RANK: Record<AlertSeverity, number> = { high: 0, medium: 1, info: 2 };

/**
 * The report's warnings (P4-R2), most severe first. Pure. Only an `ok` section can raise an alert: an unknown source
 * neither warns nor reassures. An address without code is a single high alert: the contract alerts (verification,
 * proxy, owner, ABI) do not apply to it, and its market data is meaningless.
 */
export function tokenAlerts(f: TokenFacts): TokenAlert[] {
  const out: TokenAlert[] = [];
  const add = (code: AlertCode, severity: AlertSeverity) => out.push({ code, severity });

  const creation = f.creation.status === "ok" ? f.creation.data : null;
  if (creation?.isScam) add("scam_flag", "high");

  if (f.code.status === "ok" && !f.code.data.hasCode) {
    add("no_code", "high");
    return sort(out);
  }

  const verification = f.verification.status === "ok" ? f.verification.data : null;
  if (verification && !verification.verified) add("unverified", "medium");
  if (creation && creation.ageDays !== null && creation.ageDays < NEW_CONTRACT_DAYS) add("new_contract", "medium");

  if (f.market.status === "ok") {
    const m = f.market.data;
    if (m.pairs === 0) add("no_pairs", "medium");
    else if (m.liquidityUsd !== null && m.liquidityUsd < LOW_LIQUIDITY_USD) add("low_liquidity", "medium");
  }

  if (f.proxy.status === "ok" && f.proxy.data.isProxy) add("upgradeable_proxy", "medium");
  if (f.owner.status === "ok" && f.owner.data && !f.owner.data.renounced) add("owner_active", "info");
  if (verification && verification.abiFlags.length > 0) add("abi_privileged", "info");

  return sort(out);
}

/** Array#sort is stable: same-severity alerts keep the order above. */
const sort = (alerts: TokenAlert[]) => alerts.sort((x, y) => RANK[x.severity] - RANK[y.severity]);
