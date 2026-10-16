export type InviteStatus = "activa" | "agotada" | "caducada" | "anulada";

export type InviteLike = {
  max_uses: number;
  uses: number;
  expires_at: string;
  revoked_at: string | null;
};

/** Precedence: anulada > caducada > agotada > activa. */
export function inviteStatus(inv: InviteLike, now: Date): InviteStatus {
  if (inv.revoked_at) return "anulada";
  if (new Date(inv.expires_at).getTime() <= now.getTime()) return "caducada";
  if (inv.uses >= inv.max_uses) return "agotada";
  return "activa";
}
