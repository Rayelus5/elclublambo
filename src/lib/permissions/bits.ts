// Must stay identical to the SQL bit values (public.member_global_permissions / channel_permissions).
export const Perm = {
  VIEW_CHANNEL: 1n,
  SEND_MESSAGES: 2n,
  SEND_IN_THREADS: 4n,
  MANAGE_MESSAGES: 8n,
  CREATE_INVITES: 16n,
  BAN_MEMBERS: 32n,
  MANAGE_ROLES: 64n,
  MANAGE_CHANNELS: 128n,
  MANAGE_TREASURY: 256n,
  ADMINISTRATOR: 512n,
  ATTACH_FILES: 1024n,
  EMBED_LINKS: 2048n,
  MENTION_EVERYONE: 4096n,
  ADD_REACTIONS: 8192n,
  MANAGE_TICKETS: 16384n,
  VERIFY_MEMBERS: 32768n,
  CREATE_BOUNTIES: 65536n,
} as const;

export const ALL_PERMS = 131071n;

/** The only bits that may appear in a channel permission overwrite. */
export const CHANNEL_MASK = 97295n;

/** Bits that only exist globally (never in a channel overwrite). */
export const GLOBAL_MASK = ALL_PERMS & ~CHANNEL_MASK;

export function hasPerm(perms: bigint, bit: bigint): boolean {
  if ((perms & Perm.ADMINISTRATOR) !== 0n) return true;
  return (perms & bit) === bit;
}
