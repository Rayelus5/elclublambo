import { redirect } from "next/navigation";

/** P1: the legacy raffles are replaced by the giveaways at /sorteos (ruling R-B: a 404 until that page exists). */
export default function RafflePage(): never {
  redirect("/sorteos");
}
