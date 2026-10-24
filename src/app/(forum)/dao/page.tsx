import { redirect } from "next/navigation";

/** P1: the legacy DAO is gone; donations live at /donar. Old links and notifications land there. */
export default function DaoPage(): never {
  redirect("/donar");
}
