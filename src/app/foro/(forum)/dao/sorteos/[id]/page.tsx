import { redirect } from "next/navigation";
import { clubPath } from "@/lib/club/paths";

/** P1: the legacy raffles are replaced by the giveaways at /foro/sorteos (ruling R-B: a 404 until that page exists). */
export default function RafflePage(): never {
  redirect(clubPath("/sorteos"));
}
