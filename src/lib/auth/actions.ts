"use server";

import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rpcErrorCode } from "@/lib/errors";
import { schedulePushDispatch } from "@/lib/push/schedule";
import { hitRateLimit } from "@/lib/rate-limit";
import { isSuperAdminWallet, walletFromUser } from "./wallet";
import { resolvePostLogin, type MembershipStatus } from "./post-login";

type Result = { redirectTo: string; error?: string };

const STATUSES: MembershipStatus[] = ["none", "active", "banned", "left"];
/** Invite codes are base64url of 16 random bytes (22 chars, create_invite); anything else cannot exist (review S4). */
const INVITE_CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;

function redirectForStatus(status: MembershipStatus): string {
  if (status === "active") return "/";
  if (status === "banned") return "/banned";
  return "/no-access";
}

export async function completeLogin(inviteCode: string | null, mode: "club" | "public" = "club"): Promise<Result> {
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
  // Public side: any non-banned wallet stays where it is; the client navigates to `next`.
  if (mode === "public" && status !== "banned") return { redirectTo: "public" };
  const decision = resolvePostLogin({
    status,
    isSuperAdmin: isSuperAdminWallet(wallet, process.env.SUPER_ADMIN_WALLET),
    inviteCode,
  });

  const redeem = async (code: unknown): Promise<Result> => {
    // S4: a code of the wrong shape is refused as not found before it is charged or reaches the RPC.
    if (typeof code !== "string" || !INVITE_CODE_RE.test(code)) return { redirectTo: "/no-access", error: "invite_not_found" };
    // F5-R2 redeem_invite pre-hit (its own transaction): a failed redemption rolls back any hit taken inside it.
    const limit = await hitRateLimit(supabase, "redeem_invite");
    if (limit !== "ok") {
      const c = limit === "rate_limited" ? "rate_limited" : "unknown";
      return { redirectTo: `/invite/${encodeURIComponent(code)}?error=${c}`, error: c };
    }
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
      return redeem(inviteCode);
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
