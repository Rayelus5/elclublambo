import type { NetworkKey } from "@/lib/economy/networks";

/** The owner's view of a public profile (my_public_profile / upsert_public_profile). */
export type MyPublicProfile = {
  alias: string;
  displayName: string | null;
  address: string;
  acceptNetworks: NetworkKey[];
  showMemberBadge: boolean;
};

/** What a visitor sees (public_profile_view). `alias` is null for an address without a profile. */
export type PublicProfileView = {
  alias: string | null;
  displayName: string | null;
  address: string;
  acceptNetworks: NetworkKey[];
  isMember: boolean;
};

export type SaveProfileInput = {
  alias: string;
  displayName: string;
  acceptNetworks: NetworkKey[];
  showMemberBadge: boolean;
};

export type SaveProfileError =
  | "alias_invalid"
  | "alias_reserved"
  | "alias_taken"
  | "alias_held"
  | "networks_invalid"
  | "display_name_invalid"
  | "rate_limited"
  | "forbidden"
  | "not_authenticated"
  | "unknown";

export type SaveProfileResult = { ok: true; profile: MyPublicProfile } | { ok: false; error: SaveProfileError };
