import { MAIL_GIFTS, type MailGifts } from '@galaxy/shared';
import { copy } from '../copy/es';

// What the admins' «Referidos» and the player's own code panel share (plan «referidos», part R2): the invitation link,
// a referral's gifts in words, and whether a code still lets anyone in.

/** The web app's base path (main.tsx's router basename): the sign-up lives at `/galaxy/crear-cuenta`. */
const BASE = '/galaxy';

/** The link that opens the sign-up with the code already written (CrearCuenta reads `?ref=`). */
export function inviteLink(code: string, origin: string = window.location.origin): string {
  return `${origin}${BASE}/crear-cuenta?ref=${encodeURIComponent(code)}`;
}

const list = new Intl.ListFormat('es-ES', { style: 'long', type: 'conjunction' });
const resource = copy.hub.resource;

/** «100 monedas, 50 de polvo estelar y 2 señales de galaxia»; `nothing` when the gifts give nothing. */
export function giftsText(gifts: MailGifts, nothing: string): string {
  const parts = MAIL_GIFTS.filter((k) => (gifts[k] ?? 0) > 0).map((k) => resource[k](gifts[k]!));
  return parts.length ? list.format(parts) : nothing;
}

/** Whether a code lets anyone in now: on, or turned off, past its end, or with every use taken. */
export type CodeState = 'on' | 'off' | 'expired' | 'full';

export function codeState(c: { enabled: boolean; expiresAt: string | null; maxUses: number | null; uses: number }, now: number = Date.now()): CodeState {
  if (!c.enabled) return 'off';
  if (c.expiresAt && Date.parse(c.expiresAt) <= now) return 'expired';
  if (c.maxUses !== null && c.uses >= c.maxUses) return 'full';
  return 'on';
}
