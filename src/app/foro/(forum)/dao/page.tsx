import { redirect } from "next/navigation";
import { clubPath } from "@/lib/club/paths";

/** P1: the legacy DAO is gone; donations live at /foro/donar. Old links and notifications land there. */
export default function DaoPage(): never {
  redirect(clubPath("/donar"));
}
