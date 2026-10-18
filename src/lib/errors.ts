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
  acknowledgement_required: "Para donar tienes que aceptar el aviso de riesgo.",
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
  not_found: "No se ha encontrado lo que buscas. Puede que ya no exista o que no tengas acceso.",
  fee_below_minimum: "La comisión no puede ser menor que el mínimo de la plataforma.",
  amount_out_of_range: "La cantidad está fuera de los límites permitidos.",
  invalid_solution: "Esa respuesta no puede ser la solución: debe ser una respuesta visible de otro miembro en el hilo del bounty.",
  already_marked: "Este bounty ya tiene una solución elegida y no se puede cambiar ni cancelar.",
  bounty_closed: "Este bounty está cancelado, ha expirado o se ha borrado.",
  no_solution: "Primero tienes que elegir una respuesta como solución.",
  amount_below_bounty: "El importe no puede ser menor que el del bounty.",
  already_paid: "Este bounty ya está pagado.",
  bounty_chain_inactive:
    "Este bounty se publicó en otra red; podrás pagarlo cuando esa red vuelva a estar activa.",
  payment_in_progress: "Ya hay un pago de este bounty en curso. Espera a que se confirme.",
  bounty_has_solution: "No puedes borrar un bounty con una solución elegida sin pagar.",
  channel_has_bounties:"Este canal tiene bounties y no se puede borrar.",
  reverted: "Esta donación ya no se verifica en la red y se ha revertido. Si pagaste, contacta con soporte.",
  safe_not_configured: "La tesorería aún no tiene Safe configurada en esta red.",
  safe_equals_platform: "La wallet de la plataforma no puede ser la misma que la Safe de la tesorería.",
  safe_change_blocked:
    "No puedes cambiar la Safe de esta red mientras haya participaciones, donaciones pendientes o pagos de donación abiertos: su valor está en la Safe actual.",
  safe_changed: "La Safe de esta red cambió durante la operación. Vuelve a intentarlo.",
  invalid_state: "Esta operación ya no se puede procesar en su estado actual.",
  shares_zero: "La donación es demasiado pequeña para el valor actual del fondo. La revisará el tesorero.",
  assets_stale: "El saldo del fondo aún no refleja esta donación. Se reintentará en breve.",
  self_payment: "No puedes enviarte una propina a ti mismo.",
  platform_not_configured: "La comisión de la plataforma aún no está configurada en esta red.",
  too_many_intents: "Tienes demasiados pagos pendientes. Espera a que caduquen o se confirmen.",
  tx_already_attached: "Este pago ya tiene una transacción asociada.",
  intent_expired: "Este pago ha caducado. Crea uno nuevo.",
  tx_not_found: "No encontramos la transacción en la red todavía.",
  tx_failed: "La transacción falló en la red.",
  tx_mismatch: "La transacción no coincide con el pago.",
  tx_too_old: "La transacción es anterior al pago.",
  tx_already_used: "Esta transacción ya se usó.",
  rpc_unavailable: "No pudimos consultar la red. Inténtalo de nuevo en un momento.",
  withdrawals_disabled: "Las retiradas no están activadas en esta red.",
  withdrawal_exists: "Ya tienes una retirada en curso. Cancélala o espera a que se resuelva.",
  insufficient_shares: "No tienes tantas participaciones.",
  amount_too_small: "La retirada mínima es de 1 USDC, salvo que retires todas tus participaciones.",
  nav_not_ready: "El fondo aún no tiene valoración. Inténtalo tras la próxima.",
  reason_required: "Escribe un motivo de 1 a 280 caracteres.",
  approval_expired: "La aprobación de esta retirada caducó. Vuelve a aprobarla al precio actual.",
  valuation_unavailable:
    "No se puede valorar el fondo ahora mismo (precio o red no disponibles). Inténtalo en unos minutos.",
  payout_pending: "La transacción aún no tiene confirmaciones suficientes. Vuelve a intentarlo en un momento.",
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
