const MESSAGES: Record<string, string> = {
  not_authenticated: "Tu sesión no es válida. Vuelve a conectar tu wallet.",
  not_member: "No eres miembro del club.",
  already_member: "Esta wallet ya está dentro: ya eres miembro del club.",
  forbidden: "No tienes permiso para hacer esto.",
  bootstrap_closed: "El acceso inicial ya está cerrado.",
  wallet_mismatch: "La wallet conectada no coincide con la esperada.",
  invite_not_found: "Esta invitación no existe.",
  invite_expired: "Esta invitación ha caducado.",
  invite_exhausted: "Esta invitación está agotada.",
  invite_revoked: "Esta invitación fue anulada.",
  invalid_input: "Los datos enviados no son válidos.",
  hierarchy: "No puedes hacerlo: afecta a un rango igual o superior al tuyo o a permisos que no tienes.",
  not_empty: "El canal tiene subcanales; muévelos o bórralos antes.",
  invalid_tree: "Ese movimiento rompería la estructura del árbol.",
  depth_limit: "Se ha superado la profundidad máxima (6 niveles).",
  retry: "Hubo un conflicto con otra acción. Inténtalo de nuevo.",
};

/** Allowlist untrusted input (e.g. a query param) to a known error code; never echo raw text. */
export function knownErrorCode(value: unknown): string | null {
  return typeof value === "string" && Object.hasOwn(MESSAGES, value) ? value : null;
}

const FALLBACK = "Algo falló. Inténtalo de nuevo.";

export function rpcErrorMessage(code: string): string {
  return (Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : undefined) ?? FALLBACK;
}

/** Postgres deadlock_detected / serialization_failure: safe to retry. */
const RETRYABLE_PG_CODES = new Set(["40P01", "40001"]);

/** Supabase returns `raise exception '<code>'` as error.message. */
export function rpcErrorCode(error: { message?: string; code?: string } | null | undefined): string {
  if (error?.code && RETRYABLE_PG_CODES.has(error.code)) return "retry";
  const m = error?.message;
  return m && Object.hasOwn(MESSAGES, m) ? m : "unknown";
}
