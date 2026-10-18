import "server-only";
import { cache } from "react";
import type { FormActor } from "@/components/settings/role-form";
import { Perm } from "@/lib/permissions/bits";
import type { RoleItem } from "@/lib/roles/rules";
import { createServerClient } from "@/lib/supabase/server";

type DbRole = {
  id: string;
  name: string;
  color: string;
  position: number;
  permissions: number | string;
  is_everyone: boolean;
  is_system: boolean;
  system_key: string | null;
};

export type RolesContext = { roles: RoleItem[]; actor: FormActor };

/**
 * Roles (por posición descendente) y el contexto del actor: permisos globales, si es admin y su posición más alta.
 * Memoizada por petición. Dinámico: usar dentro de Suspense.
 */
export const getRolesContext = cache(async (): Promise<RolesContext> => {
  const supabase = await createServerClient();
  const { data: rawPerms } = await supabase.rpc("my_permissions");
  const perms = BigInt(String(rawPerms ?? 0));

  const { data: dbRoles, error } = await supabase
    .from("roles")
    .select("id, name, color, position, permissions, is_everyone, is_system, system_key")
    .order("position", { ascending: false })
    .returns<DbRole[]>();
  if (error) throw error;

  const { data: me } = await supabase.rpc("current_member_id");
  let ownRoleIds = new Set<string>();
  if (typeof me === "string") {
    const { data: mine } = await supabase.from("member_roles").select("role_id").eq("member_id", me);
    ownRoleIds = new Set((mine ?? []).map((m: { role_id: string }) => m.role_id));
  }

  const roles: RoleItem[] = (dbRoles ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    position: r.position,
    permissions: String(r.permissions),
    isEveryone: r.is_everyone,
    isSystem: r.is_system,
    systemKey: r.system_key,
  }));
  // Same as member_top_position: system_key roles (Verificado, Padrino) are badges and never raise the rank.
  const top = roles.filter((r) => ownRoleIds.has(r.id) && r.systemKey === null).reduce((m, r) => Math.max(m, r.position), 0);

  return {
    roles,
    actor: { isAdmin: (perms & Perm.ADMINISTRATOR) !== 0n, perms: perms.toString(), top },
  };
});
