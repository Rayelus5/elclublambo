import "server-only";
import type { Token } from "@/lib/payments/amounts";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;

export interface MyPublicDonation {
  id: string;
  at: string;
  chainId: number;
  token: Token;
  amount: bigint;
  usd6: bigint;
  txHash: string;
  anonymous: boolean;
  listed: boolean;
}

export interface MyPublicDonations {
  totalUsd6: bigint;
  donations: MyPublicDonation[];
}

export interface PublicDonationOverview {
  totalUsd6: bigint;
  donationCount: number;
}

const big = (v: unknown): bigint => {
  try {
    return BigInt(String(v ?? "0"));
  } catch {
    return 0n;
  }
};
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0) || 0);

/** The signed-in public account's confirmed donations (RPC my_public_donations, session client). */
export async function getMyPublicDonations(): Promise<MyPublicDonations> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("my_public_donations");
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as Row;
  const list = Array.isArray(d.donations) ? (d.donations as Row[]) : [];
  return {
    totalUsd6: big(d.totalUsd6),
    donations: list.map((r) => ({
      id: str(r.id),
      at: str(r.at),
      chainId: num(r.chainId),
      token: r.token === "ETH" ? "ETH" : "USDC",
      amount: big(r.amount),
      usd6: big(r.usd6),
      txHash: str(r.txHash),
      anonymous: r.anonymous === true,
      listed: r.listed === true,
    })),
  };
}

/** Public totals for the donate page: no names, no addresses (service-role RPC, server only). */
export async function getPublicDonationOverview(): Promise<PublicDonationOverview> {
  const { data, error } = await createAdminClient().rpc("public_donation_overview");
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as Row;
  return { totalUsd6: big(d.totalUsd6), donationCount: num(d.donationCount) };
}
