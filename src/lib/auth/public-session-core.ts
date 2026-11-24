import { walletFromUser } from "./wallet";

export type PublicSession = { userId: string; wallet: `0x${string}`; isMember: boolean };

type UserLike = Parameters<typeof walletFromUser>[0] & { id: string };
type RpcClient = { rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }> };

/**
 * Who the public side sees for this signed-in user, or null: the same rules on the server (getPublicSession, the gate in
 * front of every public action) and in the browser (the header). A wallet is required, banned members have no public
 * account, and (A-R13) neither has an account made while registration is closed (held, no members row). Only status
 * `none` can be held; a failed read fails closed.
 */
export async function resolvePublicSession(user: UserLike | null, client: RpcClient): Promise<PublicSession | null> {
  if (!user) return null;
  const wallet = walletFromUser(user);
  if (!wallet) return null;
  const { data: status, error } = await client.rpc("my_membership_status");
  if (error || status === "banned") return null;
  if (status === "none") {
    const { data: blocked, error: blockErr } = await client.rpc("my_registration_blocked");
    if (blockErr || blocked !== false) return null;
  }
  return { userId: user.id, wallet, isMember: status === "active" };
}
