"use server";

// Acciones de la pestaña «Administración». Las RPC `admin_*` vuelven a comprobar el bit 512 y lo auditan; aquí solo se
// valida la forma. Tras cada cambio se tira la caché del estado del sitio para que el proxy lo vea en segundos.
import { revalidatePath } from "next/cache";
import { clubPath } from "@/lib/club/paths";
import { rpcErrorCode } from "@/lib/errors";
import { hashPassword, PASSWORD_MAX, PASSWORD_MIN } from "@/lib/admin/password";
import { invalidateSiteState } from "@/lib/admin/site-state";
import { SWITCH_KEYS, type SwitchKey } from "@/lib/admin/state";
import { createServerClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; error: string };

export type MaintenanceInput = {
  enabled: boolean;
  mode: "default" | "custom";
  messageEs?: string | null;
  messageEn?: string | null;
  returnAt?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
};

const WALLET = /^0x[0-9a-fA-F]{40}$/;
const MESSAGE_MAX = 500;
const NOTE_MAX = 80;
const INVALID: Result = { ok: false, error: "invalid_input" };

async function call(fn: string, args: Record<string, unknown>): Promise<Result> {
  const supabase = await createServerClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, error: rpcErrorCode(error) };
  invalidateSiteState();
  revalidatePath(clubPath("/settings/administracion"));
  return { ok: true };
}

export async function setSwitchAction(key: SwitchKey, enabled: boolean): Promise<Result> {
  if (!(SWITCH_KEYS as readonly unknown[]).includes(key) || typeof enabled !== "boolean") return INVALID;
  return call("admin_set_switch", { p_key: key, p_enabled: enabled });
}

const optionalText = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.length <= MESSAGE_MAX);
const optionalDate = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && !Number.isNaN(new Date(v).getTime()));

export async function setMaintenanceAction(input: MaintenanceInput): Promise<Result> {
  if (typeof input !== "object" || input === null) return INVALID;
  const { enabled, mode, messageEs, messageEn, returnAt, startsAt, endsAt } = input;
  if (typeof enabled !== "boolean" || (mode !== "default" && mode !== "custom")) return INVALID;
  if (mode === "default") {
    return call("admin_set_maintenance", {
      p_enabled: enabled,
      p_mode: "default",
      p_message_es: null,
      p_message_en: null,
      p_return_at: null,
      p_starts_at: null,
      p_ends_at: null,
    });
  }
  if (![messageEs, messageEn].every(optionalText) || ![returnAt, startsAt, endsAt].every(optionalDate)) return INVALID;
  // El resto de reglas (mensajes obligatorios, fechas futuras y en orden) las impone la RPC: maintenance_invalid.
  return call("admin_set_maintenance", {
    p_enabled: enabled,
    p_mode: "custom",
    p_message_es: messageEs ?? null,
    p_message_en: messageEn ?? null,
    p_return_at: returnAt ?? null,
    p_starts_at: startsAt ?? null,
    p_ends_at: endsAt ?? null,
  });
}

/** La contraseña se hashea aquí (scrypt); a la RPC solo llega el hash. */
export async function setMaintenancePasswordAction(password: string): Promise<Result> {
  if (typeof password !== "string" || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return { ok: false, error: "password_invalid" };
  }
  return call("admin_set_maintenance_password", { p_hash: await hashPassword(password) });
}

export async function addAccessWalletAction(wallet: string, note: string): Promise<Result> {
  if (typeof wallet !== "string" || !WALLET.test(wallet.trim())) return { ok: false, error: "wallet_invalid" };
  if (typeof note !== "string") return INVALID;
  if (note.trim().length > NOTE_MAX) return { ok: false, error: "note_invalid" };
  return call("admin_add_access_wallet", { p_wallet: wallet.trim(), p_note: note.trim() });
}

export async function removeAccessWalletAction(wallet: string): Promise<Result> {
  if (typeof wallet !== "string" || !WALLET.test(wallet.trim())) return { ok: false, error: "wallet_invalid" };
  return call("admin_remove_access_wallet", { p_wallet: wallet.trim() });
}
