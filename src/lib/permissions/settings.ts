import { hasPerm, Perm } from "@/lib/permissions/bits";

export type SettingsSection = { href: string; label: string };

/** Secciones de ajustes visibles para unos permisos globales, en orden. */
export function settingsSections(perms: bigint): SettingsSection[] {
  const out: SettingsSection[] = [];
  if (hasPerm(perms, Perm.MANAGE_CHANNELS)) out.push({ href: "/settings/channels", label: "Canales" });
  if (hasPerm(perms, Perm.MANAGE_ROLES)) out.push({ href: "/settings/roles", label: "Roles" });
  if (hasPerm(perms, Perm.MANAGE_CHANNELS)) out.push({ href: "/settings/links", label: "Enlaces" });
  // SuperAdmin only: the raw bit, not hasPerm's other-bit logic.
  if ((perms & Perm.ADMINISTRATOR) !== 0n) out.push({ href: "/settings/economia", label: "Economía" });
  return out;
}
