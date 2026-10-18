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
  slowmode: "Vas demasiado rápido. Espera un poco antes de volver a escribir.",
  not_a_contract: "Esa dirección no es un contrato en Linea.",
  network: "No se pudo verificar el contrato. Inténtalo de nuevo.",
  too_long: "El mensaje es demasiado largo.",
  too_many_attachments: "Puedes adjuntar como máximo 4 imágenes.",
  too_many_reactions: "Este mensaje ya tiene el máximo de reacciones distintas.",
  thread_invalid: "No se puede responder a ese mensaje.",
  rate_limited: "Has hecho demasiadas acciones seguidas. Espera un rato antes de volver a intentarlo.",
  already_reported: "Ya has reportado este mensaje. El equipo de moderación lo revisará.",
  too_many_open_tickets: "Ya tienes 3 tickets abiertos. Cierra alguno para abrir otro.",
  ticket_closed: "Este ticket está cerrado. Solo el equipo puede reabrirlo.",
  handle_invalid: "El @handle debe tener entre 3 y 20 caracteres: letras sin acentos, números o guion bajo.",
  handle_reserved: "Ese nombre está reservado",
  handle_taken: "Ese nombre ya está en uso",
  handle_cooldown: "Solo puedes cambiar tu @handle una vez cada 30 días",
  handle_required: "Elige tu @handle para continuar.",
  bio_too_long: "La bio puede tener como máximo 280 caracteres.",
  links_invalid: "Los enlaces deben ser https, tener un dominio válido, medir como máximo 200 caracteres y ser 3 como mucho.",
  avatar_invalid: "La imagen de perfil no es válida: usa PNG, JPG o WebP de hasta 2 MB.",
  fee_out_of_range: "La comisión mínima debe estar entre 0% y 50%.",
  address_invalid: "La dirección no es válida: debe ser una dirección 0x de 40 caracteres y no la dirección cero.",
  chain_invalid: "Esa red no está soportada.",
  retry:"Hubo un conflicto con otra acción. Inténtalo de nuevo.",
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
