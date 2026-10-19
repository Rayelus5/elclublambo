import { Perm } from "@/lib/permissions/bits";

export type BitLabel = { bit: bigint; label: string };

/** Los 11 bits que pueden aparecer en un overwrite de canal, en orden de columna. */
export const CHANNEL_BIT_LIST: readonly BitLabel[] = [
  { bit: Perm.VIEW_CHANNEL, label: "Ver canal" },
  { bit: Perm.SEND_MESSAGES, label: "Enviar mensajes" },
  { bit: Perm.SEND_IN_THREADS, label: "Responder en hilos" },
  { bit: Perm.MANAGE_MESSAGES, label: "Moderar mensajes" },
  { bit: Perm.ATTACH_FILES, label: "Adjuntar imágenes" },
  { bit: Perm.EMBED_LINKS, label: "Insertar enlaces" },
  { bit: Perm.MENTION_EVERYONE, label: "Mencionar a todos" },
  { bit: Perm.ADD_REACTIONS, label: "Reaccionar" },
  { bit: Perm.MANAGE_TICKETS, label: "Gestionar tickets" },
  { bit: Perm.CREATE_BOUNTIES, label: "Crear bounties" },
  { bit: Perm.CREATE_POLLS, label: "Crear encuestas" },
];

/** Bits globales (ADMINISTRATOR nunca se ofrece ni se etiqueta). */
export const GLOBAL_BIT_LIST: readonly BitLabel[] = [
  { bit: Perm.CREATE_INVITES, label: "Crear invitaciones" },
  { bit: Perm.BAN_MEMBERS, label: "Banear miembros" },
  { bit: Perm.MANAGE_ROLES, label: "Gestionar roles" },
  { bit: Perm.MANAGE_CHANNELS, label: "Gestionar canales" },
  { bit: Perm.MANAGE_TREASURY, label: "Gestionar tesorería" },
  { bit: Perm.VERIFY_MEMBERS, label: "Verificar miembros" },
];

/** Los 17 bits que se pueden marcar en un rol: globales primero, luego los de canal. */
export const SELECTABLE_BIT_LIST: readonly BitLabel[] = [...GLOBAL_BIT_LIST, ...CHANNEL_BIT_LIST];

export const PERM_LABEL: ReadonlyMap<bigint, string> = new Map(SELECTABLE_BIT_LIST.map((b) => [b.bit, b.label]));

/**
 * Bits que un rol de sistema o @everyone puede tener si quien edita no es admin. Debe ser idéntico a la máscara
 * "member-safe" del SQL (207895, update_role / set_overwrite): ver, enviar, responder en hilos, crear invitaciones,
 * adjuntar, insertar enlaces, reaccionar, crear bounties y crear encuestas.
 */
export const SAFE_ROLE_MASK =
  Perm.VIEW_CHANNEL |
  Perm.SEND_MESSAGES |
  Perm.SEND_IN_THREADS |
  Perm.CREATE_INVITES |
  Perm.ATTACH_FILES |
  Perm.EMBED_LINKS |
  Perm.ADD_REACTIONS |
  Perm.CREATE_BOUNTIES |
  Perm.CREATE_POLLS;
