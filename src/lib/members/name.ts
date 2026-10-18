import { shortAddress } from "@/lib/auth/wallet";

export type MemberIdentity = {
  handle: string | null;
  displayName: string | null;
  walletAddress: string;
  avatarPath: string | null;
};

export function memberName(m: MemberIdentity): string {
  return m.displayName?.trim() || (m.handle ? `@${m.handle}` : shortAddress(m.walletAddress));
}

export function mentionLabel(m: MemberIdentity): string {
  return m.handle ? `@${m.handle}` : `@${memberName(m)}`;
}

export function avatarUrl(path: string | null): string | null {
  if (!path) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/${path}`;
}

/** Row shape shared by every `members` select that feeds an identity. */
export type MemberIdentityRow = {
  handle: string | null;
  display_name: string | null;
  wallet_address: string;
  avatar_path: string | null;
};

export const MEMBER_IDENTITY_COLUMNS = "handle, display_name, wallet_address, avatar_path";

export function identityFromRow(r: MemberIdentityRow): MemberIdentity {
  return { handle: r.handle ?? null, displayName: r.display_name ?? null, walletAddress: r.wallet_address, avatarPath: r.avatar_path ?? null };
}
