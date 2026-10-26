// Acceso durante el mantenimiento (A-R4, A-R6). Lo usa el proxy: sin `server-only` ni service role. La fila de
// `maintenance_grants` decide; la caché de módulo solo guarda positivos, 5 s por usuario, y es best-effort.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSuperAdminWallet, walletFromUser } from "@/lib/auth/wallet";

export type MaintenanceAccess = "superadmin" | "granted" | "none";

/** A-R15: franja «Mantenimiento activo». Cosmética: falsificarla no abre nada. */
export const MAINTENANCE_BANNER_COOKIE = "elclub-mnt";

const TTL_MS = 5000;
const MAX_ENTRIES = 500;
const cache = new Map<string, { at: number; access: Exclude<MaintenanceAccess, "none"> }>();

export function __resetAccessCache(): void {
  cache.clear();
}

export async function maintenanceAccess(
  supabase: Pick<SupabaseClient, "rpc">,
  user: { id: string } & NonNullable<Parameters<typeof walletFromUser>[0]>,
  env: Record<string, string | undefined> = process.env,
): Promise<MaintenanceAccess> {
  const wallet = walletFromUser(user);
  if (wallet !== null && isSuperAdminWallet(wallet, env.SUPER_ADMIN_WALLET)) return "superadmin";

  const now = Date.now();
  const hit = cache.get(user.id);
  if (hit && now - hit.at < TTL_MS) return hit.access;
  cache.delete(user.id);

  let access: MaintenanceAccess = "none";
  try {
    const { data, error } = await supabase.rpc("my_maintenance_access");
    if (!error && (data === "superadmin" || data === "granted")) access = data;
  } catch {
    access = "none";
  }
  if (access !== "none") {
    if (cache.size >= MAX_ENTRIES) cache.clear();
    cache.set(user.id, { at: now, access });
  }
  return access;
}
