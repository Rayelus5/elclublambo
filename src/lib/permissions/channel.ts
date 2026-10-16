import { ALL_PERMS, GLOBAL_MASK, Perm } from "./bits";

export type Ow = { allow: bigint; deny: bigint };

export type ChannelPermInput = {
  /** OR of @everyone and the member's roles (NOT member_global_permissions). */
  rolesBase: bigint;
  isAdmin: boolean;
  /** Ancestors root -> channel, inclusive. `roles` holds only overwrites of roles the member has (excluding @everyone). */
  path: Array<{ everyone?: Ow; roles: Ow[]; member?: Ow }>;
  /** Deny mask of the member's penalty row; its allow never grants channel bits. */
  penaltyDeny: bigint;
  active: boolean;
};

function apply(p: bigint, o: Ow | undefined): bigint {
  return o ? (p & ~o.deny) | o.allow : p;
}

/**
 * Pure mirror of public.channel_permissions (F2a, DAO gate always passes).
 * Must stay in lockstep with supabase/migrations/20261016100003_channel_permissions.sql.
 */
export function computeChannelPermissions(i: ChannelPermInput): bigint {
  if (!i.active) return 0n;
  if (i.isAdmin) return ALL_PERMS;

  let p = i.rolesBase;
  for (const node of i.path) {
    p = apply(p, node.everyone);
    if (node.roles.length > 0) {
      let allow = 0n;
      let deny = 0n;
      for (const r of node.roles) {
        allow |= r.allow;
        deny |= r.deny;
      }
      p = apply(p, { allow, deny });
    }
    p = apply(p, node.member);
    if ((p & Perm.VIEW_CHANNEL) === 0n) return p & GLOBAL_MASK;
  }
  return p & ~i.penaltyDeny;
}
