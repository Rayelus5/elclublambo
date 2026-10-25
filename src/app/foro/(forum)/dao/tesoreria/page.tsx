import { redirect } from "next/navigation";
import { clubPath } from "@/lib/club/paths";

/** P1: the legacy treasurer panel is gone; the Safe's balances and expenses are on /foro/donar. */
export default function TreasuryPage(): never {
  redirect(clubPath("/donar"));
}
