import fixture from "./channel-permissions.json";
import type { ChannelPermInput, Ow } from "@/lib/permissions/channel";

type RawOw = { allow: string; deny: string };
export type ParityCase = {
  name: string;
  roles: Array<{ key: string; permissions: string }>;
  member: { roleKeys: string[]; active: boolean; penaltyDeny: string; penaltyAllow?: string };
  path: Array<{
    key: string;
    everyone?: RawOw;
    roles?: Array<{ roleKey: string } & RawOw>;
    member?: RawOw;
  }>;
  expected: string;
};

export const EVERYONE_PERMISSIONS = BigInt(fixture.everyonePermissions);
export const cases = fixture.cases as ParityCase[];

const ow = (o: RawOw): Ow => ({ allow: BigInt(o.allow), deny: BigInt(o.deny) });

/** Builds the pure TS input from a declarative case. */
export function toInput(c: ParityCase): ChannelPermInput {
  const perms = new Map(c.roles.map((r) => [r.key, BigInt(r.permissions)]));
  let rolesBase = EVERYONE_PERMISSIONS;
  for (const k of c.member.roleKeys) rolesBase |= perms.get(k) ?? 0n;
  const mine = new Set(c.member.roleKeys);
  return {
    rolesBase,
    isAdmin: (rolesBase & 512n) !== 0n,
    active: c.member.active,
    penaltyDeny: BigInt(c.member.penaltyDeny),
    path: c.path.map((n) => ({
      everyone: n.everyone ? ow(n.everyone) : undefined,
      roles: (n.roles ?? []).filter((r) => mine.has(r.roleKey)).map(ow),
      member: n.member ? ow(n.member) : undefined,
    })),
  };
}
