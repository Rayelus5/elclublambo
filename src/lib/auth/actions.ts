"use server";

import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rpcErrorCode } from "@/lib/errors";
import { schedulePushDispatch } from "@/lib/push/schedule";
import { isSuperAdminWallet, walletFromUser } from "./wallet";
import { resolvePostLogin, type MembershipStatus } from "./post-login";

type Result = { redirectTo: string; error?: string };

const STATUSES: MembershipStatus[] = ["none", "active", "banned", "left"];

function redirectForStatus(status: MembershipStatus): string {
  if (status === "active") return "/";
  if (status === "banned") return "/banned";
  return "/no-access";
}

export async function completeLogin(inviteCode: string | null): Promise<Result> {
  const supabase = await createServerClient();
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user) return { redirectTo: "/login" };

  const wallet = walletFromUser(user);
  if (!wallet) return { redirectTo: "/no-access" };

  const readStatus = async (): Promise<MembershipStatus | null> => {
    const { data: s, error } = await supabase.rpc("my_membership_status");
    return !error && STATUSES.includes(s as MembershipStatus) ? (s as MembershipStatus) : null;
  };

  const status = await readStatus();
  if (!status) return { redirectTo: "/no-access", error: "unknown" };
  const decision = resolvePostLogin({
    status,
    isSuperAdmin: isSuperAdminWallet(wallet, process.env.SUPER_ADMIN_WALLET),
    inviteCode,
  });

  const redeem = async (code: string): Promise<Result> => {
    const { error } = await supabase.rpc("redeem_invite", { p_code: code });
    if (!error) {
      schedulePushDispatch();
      return { redirectTo: "/" };
    }
    const c = rpcErrorCode(error);
    return { redirectTo: `/invite/${encodeURIComponent(code)}?error=${c}`, error: c };
  };

  switch (decision) {
    case "enter":
      return { redirectTo: "/" };
    case "banned":
      return { redirectTo: "/banned" };
    case "no_access":
      return { redirectTo: "/no-access" };
    case "redeem":
      return redeem(inviteCode!);
    case "bootstrap": {
      const { error } = await createAdminClient().rpc("bootstrap_super_admin", {
        p_auth_user_id: user.id,
        p_wallet: wallet,
      });
      if (!error) return { redirectTo: redirectForStatus((await readStatus()) ?? "none") };
      const c = rpcErrorCode(error);
      if (c === "bootstrap_closed") {
        return inviteCode ? redeem(inviteCode) : { redirectTo: "/no-access" };
      }
      return { redirectTo: "/no-access", error: c };
    }
  }
}
