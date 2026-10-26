import "server-only";
import { safeError } from "@/lib/security/redact";
import { createServerClient } from "@/lib/supabase/server";
import { parseSiteState, type MaintenanceConfig, type SwitchKey } from "./state";

export type AdminOverview = {
  switches: Record<SwitchKey, boolean>;
  maintenance: MaintenanceConfig;
  passwordSet: boolean;
  passwordUpdatedAt: string | null;
  accessList: Array<{ wallet: string; note: string | null; createdAt: string }>;
  history: Array<{ at: string; actor: string; action: string; payload: Record<string, unknown> }>;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isRecord) : []);

/** Todo lo que pinta la pestaña, en una sola RPC (`admin_overview`, solo bit 512). Lanza si falla. */
export async function getAdminOverview(): Promise<AdminOverview> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("admin_overview");
  if (error || !isRecord(data)) {
    console.error("[admin] overview failed", safeError(error ?? new Error("empty")));
    throw new Error("admin_overview failed");
  }
  const { switches, maintenance } = parseSiteState({ switches: data.switches, maintenance: data.maintenance });
  return {
    switches,
    maintenance,
    passwordSet: data.passwordSet === true,
    passwordUpdatedAt: str(data.passwordUpdatedAt),
    accessList: rows(data.accessList).flatMap((r) => {
      const wallet = str(r.wallet);
      return wallet ? [{ wallet, note: str(r.note), createdAt: str(r.createdAt) ?? "" }] : [];
    }),
    history: rows(data.history).flatMap((r) => {
      const at = str(r.at);
      const action = str(r.action);
      return at && action
        ? [{ at, action, actor: str(r.actor) ?? "—", payload: isRecord(r.payload) ? r.payload : {} }]
        : [];
    }),
  };
}
