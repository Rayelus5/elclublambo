export type MembershipStatus = "none" | "active" | "banned" | "left";
export type PostLoginDecision = "enter" | "bootstrap" | "redeem" | "banned" | "no_access";

export function resolvePostLogin(i: {
  status: MembershipStatus;
  isSuperAdmin: boolean;
  inviteCode: string | null;
}): PostLoginDecision {
  if (i.status === "banned") return "banned";
  if (i.status === "active") return "enter";
  if (i.status === "none") {
    if (i.isSuperAdmin) return "bootstrap";
    if (i.inviteCode) return "redeem";
  }
  return "no_access";
}
