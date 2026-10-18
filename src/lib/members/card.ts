// Member card, channel member list and the presence heartbeat (supabase/migrations/20261019000005_member_card_presence.sql).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemberIdentity } from "@/lib/members/name";

type Client = Pick<SupabaseClient, "rpc">;

export interface MemberCardData extends MemberIdentity {
  id: string;
  bio: string | null;
  status: string;
  joinedAt: string;
  online: boolean;
  roles: { name: string; color: string }[];
}

export interface ChannelMember extends MemberIdentity {
  id: string;
  online: boolean;
  roleColor: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

export async function getMemberCard(supabase: Client, memberId: string): Promise<MemberCardData> {
  const { data, error } = await supabase.rpc("member_card", { p_member: memberId });
  if (error) throw new Error(error.message);
  const o = (data ?? {}) as Record<string, unknown>;
  const roles = Array.isArray(o.roles) ? (o.roles as Record<string, unknown>[]) : [];
  return {
    id: String(o.id ?? memberId),
    handle: str(o.handle),
    displayName: str(o.displayName),
    walletAddress: String(o.walletAddress ?? ""),
    avatarPath: str(o.avatarPath),
    bio: str(o.bio),
    status: String(o.status ?? "active"),
    joinedAt: String(o.joinedAt ?? ""),
    online: o.online === true,
    roles: roles.map((r) => ({ name: String(r.name ?? ""), color: String(r.color ?? "") })).filter((r) => r.name),
  };
}

export async function getChannelMembers(supabase: Client, channelId: string): Promise<ChannelMember[]> {
  const { data, error } = await supabase.rpc("channel_members", { p_channel: channelId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.member_id),
    handle: str(r.handle),
    displayName: str(r.display_name),
    walletAddress: String(r.wallet_address ?? ""),
    avatarPath: str(r.avatar_path),
    online: r.online === true,
    roleColor: str(r.role_color),
  }));
}

/** Heartbeat: the server stamps the session's own member (never a client-supplied id). Failures are ignored. */
export async function touchPresence(supabase: Client): Promise<void> {
  await supabase.rpc("touch_presence");
}
