import { redirect } from "next/navigation";

/** P1: the legacy treasurer panel is gone; the Safe's balances and expenses are on /donar. */
export default function TreasuryPage(): never {
  redirect("/donar");
}
