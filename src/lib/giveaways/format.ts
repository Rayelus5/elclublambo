// Display helpers of the giveaways UI (/sorteos). Pure: shared by server and client components.
import type { GiveawayStatus } from "@/lib/giveaways/types";
import type { RoleItem } from "@/lib/roles/rules";

/** The member-safe mask of SQL _giveaway_role_ok / update_role (P1-R9). */
const MEMBER_SAFE = 207895n;

/** "2 d 4 h", "3 h 20 min", "9 min 5 s", "42 s"; null once the time is up. */
export function formatCountdown(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${sec} s`;
  return `${sec} s`;
}

export const STATUS_LABEL: Record<GiveawayStatus, string> = {
  open: "Abierto",
  closed: "Esperando el sorteo",
  drawn: "Sorteado",
  void: "Sin participantes",
  cancelled: "Cancelado",
};

/** "24 oct 2026, 18:00" in the viewer's zone (rendered on the client) or the server's. */
export function formatClose(iso: string): string {
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export const participants = (n: number) => `${n} ${n === 1 ? "participante" : "participantes"}`;

export type RoleOption = { id: string; name: string; color: string };

/**
 * The roles a treasurer may offer as a prize (P1-R9): not @everyone, no is_system or system_key, permissions inside the
 * member-safe mask, no channel overwrite widening it past that mask (`widened`, see widenedRoleIds), and strictly below
 * the creator unless ADMINISTRATOR. create_giveaway re-checks all of it (_giveaway_role_ok) and answers role_not_allowed.
 */
export function giveawayRoleOptions(
  ctx: { roles: readonly RoleItem[]; actor: { isAdmin: boolean; perms?: string; top: number } },
  widened: ReadonlySet<string> = new Set(),
): RoleOption[] {
  return ctx.roles
    .filter((r) => {
      if (r.isEveryone || r.isSystem || r.systemKey !== null || widened.has(r.id)) return false;
      let perms: bigint;
      try {
        perms = BigInt(r.permissions);
      } catch {
        return false;
      }
      if ((perms & ~MEMBER_SAFE) !== 0n) return false;
      return ctx.actor.isAdmin || r.position < ctx.actor.top;
    })
    .map((r) => ({ id: r.id, name: r.name, color: r.color }));
}

/**
 * The roles some channel overwrite grants bits outside the member-safe mask (e.g. MANAGE_MESSAGES in one channel), from
 * permission_overwrites rows of target_type 'role'. A malformed allow counts as widening (never offered).
 */
export function widenedRoleIds(rows: readonly { target_id: string; allow: number | string | null }[]): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    let allow: bigint;
    try {
      allow = BigInt(String(r.allow ?? 0));
    } catch {
      out.add(r.target_id);
      continue;
    }
    if ((allow & ~MEMBER_SAFE) !== 0n) out.add(r.target_id);
  }
  return out;
}

/** A prize the member actually won: a winner kept on an unawarded prize (role_unavailable) is not a win. */
export function isWin(p: { iWon: boolean; status: string }): boolean {
  return p.iWon && (p.status === "awarded" || p.status === "paid" || p.status === "delivered");
}
