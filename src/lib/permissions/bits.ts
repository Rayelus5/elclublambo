// Must stay identical to the SQL bit values (public.member_global_permissions).
export const Perm = {
  VIEW_CHANNEL: 1n,
  CREATE_THREADS: 2n,
  SEND_REPLIES: 4n,
  MANAGE_MESSAGES: 8n,
  CREATE_INVITES: 16n,
  BAN_MEMBERS: 32n,
  MANAGE_ROLES: 64n,
  MANAGE_CHANNELS: 128n,
  MANAGE_TREASURY: 256n,
  ADMINISTRATOR: 512n,
} as const;

export const ALL_PERMS = 1023n;

export function hasPerm(perms: bigint, bit: bigint): boolean {
  if ((perms & Perm.ADMINISTRATOR) !== 0n) return true;
  return (perms & bit) === bit;
}
