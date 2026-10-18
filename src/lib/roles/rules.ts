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

/**
 * Drag & drop in Ajustes > Roles: SuperAdmin and @everyone stay pinned; the roles held by everyone they are given to
 * (system_key: Verificado, Padrino) only move for the SuperAdmin (move_role enforces the same).
 */
export function canDragRole(role: RoleItem, actor: Actor): boolean {
  if (role.isSystem || role.isEveryone) return false;
  if (role.systemKey !== null && !actor.isAdmin) return false;
  return canManageRole(role, actor);
}

/**
 * The position to send to move_role after a drop: just above the role now below it (move_role shifts any occupied run
 * upwards, keeping the order), or 1 when it was dropped last, right above @everyone. `order` is highest first.
 */
export function dropPosition(order: readonly RoleItem[], movedId: string): number {
  const i = order.findIndex((r) => r.id === movedId);
  const below = order[i + 1];
  return !below || below.isEveryone ? 1 : below.position + 1;
}
