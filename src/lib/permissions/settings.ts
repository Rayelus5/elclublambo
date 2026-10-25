import { hasPerm, Perm } from "@/lib/permissions/bits";
import { clubPath } from "@/lib/club/paths";

export type SettingsSection = { href: string; label: string };

/** Secciones de ajustes visibles para unos permisos globales, en orden. */
export function settingsSections(perms: bigint): SettingsSection[] {
  const out: SettingsSection[] = [];
  if (hasPerm(perms, Perm.MANAGE_CHANNELS)) out.push({ href: clubPath("/settings/channels"), label: "Canales" });
  if (hasPerm(perms, Perm.MANAGE_ROLES)) out.push({ href: clubPath("/settings/roles"), label: "Roles" });
  if (hasPerm(perms, Perm.MANAGE_CHANNELS)) out.push({ href: clubPath("/settings/links"), label: "Enlaces" });
  // SuperAdmin only: the raw bit, not hasPerm's other-bit logic.
  if ((perms & Perm.ADMINISTRATOR) !== 0n) out.push({ href: clubPath("/settings/economia"), label: "Economía" });
  return out;
}
