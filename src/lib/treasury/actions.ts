"use server";

import { revalidatePath } from "next/cache";
import { rpcErrorCode, rpcErrorMessage } from "@/lib/errors";
import { createServerClient } from "@/lib/supabase/server";

type Fail = { ok: false; error: string; code: string };
const fail = (code: string): Fail => ({ ok: false, code, error: rpcErrorMessage(code) });

export async function setRankingVisibleAction(visible: boolean): Promise<{ ok: true } | Fail> {
  if (typeof visible !== "boolean") return fail("invalid_input");
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("set_dao_ranking_visible", { p_visible: visible });
  if (error) return fail(rpcErrorCode(error));
  revalidatePath("/dao");
  revalidatePath("/perfil");
  return { ok: true };
}
