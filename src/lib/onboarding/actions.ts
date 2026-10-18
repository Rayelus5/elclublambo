"use server";

import { revalidatePath } from "next/cache";
import { rpcErrorCode, rpcErrorMessage } from "@/lib/errors";
import { createServerClient } from "@/lib/supabase/server";

/** Marks the first-login welcome as done. The RPC raises `handle_required` while the member has no @handle. */
export async function completeWelcomeAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("complete_welcome");
  if (error) return { ok: false, error: rpcErrorMessage(rpcErrorCode(error)) };
  revalidatePath("/", "layout");
  return { ok: true };
}
