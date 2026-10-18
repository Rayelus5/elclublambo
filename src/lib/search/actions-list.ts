import { hasPerm, Perm } from "@/lib/permissions/bits";
import { GUIDE_SECTIONS, type GuideSlug } from "@/lib/guide/sections";

export type ActionIcon = "invite" | "settings" | "members" | "mentions" | "tickets" | "ticket" | "reports" | "profile" | "guide";

export type PaletteAction = {
  id: string;
  label: string;
  href: string;
  icon: ActionIcon;
  /** Extra words the local filter also matches (never rendered). */
  keywords?: string;
};

const GUIDE_KEYWORDS: Record<GuideSlug, string> = {
  propinas: "propinas donar premiar tip eth usdc",
  bounties: "bounty recompensa pago solución",
  dao: "dao tesorería shares donación safe",
  candados: "candado gating acceso requisito canal",
  redes: "red testnet mainnet seguridad phishing modo prueba",
};

export type TicketChannel = { id: string; name: string };

/**
 * Palette actions the member can actually use. Pure: the forum layout calls it on the server with data it already
 * loaded and hands the (serializable) result to the client provider.
 */
export function buildActions({
  perms,
  canReports,
  ticketChannels,
  wallet,
}: {
  perms: bigint;
  canReports: boolean;
  ticketChannels: readonly TicketChannel[];
  wallet: string;
}): PaletteAction[] {
  const out: PaletteAction[] = [];
  if (hasPerm(perms, Perm.CREATE_INVITES)) {
    out.push({ id: "invite", label: "Crear invitación", href: "/invites", icon: "invite", keywords: "invitaciones invitar" });
  }
  if (hasPerm(perms, Perm.MANAGE_CHANNELS) || hasPerm(perms, Perm.MANAGE_ROLES)) {
    out.push({ id: "settings", label: "Ajustes del servidor", href: "/settings", icon: "settings", keywords: "ajustes configuración roles canales" });
  }
  if (hasPerm(perms, Perm.BAN_MEMBERS) || hasPerm(perms, Perm.VERIFY_MEMBERS)) {
    out.push({ id: "members", label: "Miembros", href: "/admin/members", icon: "members", keywords: "gestionar verificar banear" });
  }
  out.push({ id: "mentions", label: "Mis menciones", href: "/notifications?filter=mentions", icon: "mentions", keywords: "notificaciones" });
  out.push({ id: "tickets", label: "Mis tickets", href: "/tickets", icon: "tickets", keywords: "soporte" });
  for (const c of ticketChannels) {
    out.push({ id: `ticket:${c.id}`, label: `Abrir ticket en #${c.name}`, href: `/c/${c.id}?openTicket=1`, icon: "ticket", keywords: "soporte ayuda" });
  }
  if (canReports) {
    out.push({ id: "reports", label: "Cola de reportes", href: "/moderation/reports", icon: "reports", keywords: "moderación denuncias" });
  }
  out.push({ id: "guide", label: "Guía", href: "/guia", icon: "guide", keywords: "ayuda novato empezar cómo funciona bienvenida" });
  for (const s of GUIDE_SECTIONS) {
    out.push({ id: `guide:${s.slug}`, label: `Guía: ${s.title}`, href: `/guia/${s.slug}`, icon: "guide", keywords: GUIDE_KEYWORDS[s.slug] });
  }
  out.push({ id: "profile", label: "Mi perfil", href: `/u/${wallet}`, icon: "profile" });
  return out;
}

/** Destination of a message result. `nonce` ([A-Za-z0-9_-]{1,32}) makes choosing the same message twice re-highlight. */
export function messageHref(m: { channelId: string; id: string; threadRootId: string | null }, nonce: string): string {
  const thread = m.threadRootId ? `thread=${m.threadRootId}&` : "";
  return `/c/${m.channelId}?${thread}m=${m.id}&h=${nonce}`;
}
