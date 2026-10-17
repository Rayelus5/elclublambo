export type Actor = { isAdmin: boolean; top: number };

export type RoleItem = {
  id: string;
  name: string;
  color: string;
  position: number;
  /** bigint serializado */
  permissions: string;
  isEveryone: boolean;
  isSystem: boolean;
  systemKey: string | null;
};

/** ¿Puede el actor editar/borrar/mover este rol? (@everyone: solo sus permisos; el servidor lo vuelve a validar.) */
export function canManageRole(
  role: { position: number; isSystem: boolean; isEveryone: boolean },
  actor: Actor,
): boolean {
  if (role.isEveryone) return true;
  if (role.isSystem) return false;
  return actor.isAdmin || role.position < actor.top;
}

/** move_role acepta posiciones 1..top-1. */
export function canMoveTo(position: number, actor: Actor): boolean {
  return Number.isInteger(position) && position >= 1 && position < actor.top;
}
