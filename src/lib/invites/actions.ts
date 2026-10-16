"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { rpcErrorCode } from "@/lib/errors";
import { createServerClient } from "@/lib/supabase/server";
import { ALLOWED_EXPIRY_HOURS, ALLOWED_USES } from "./options";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseAllowed(raw: FormDataEntryValue | null, allowed: readonly number[]): number | null {
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return allowed.includes(n) ? n : null;
}

async function siteOrigin(): Promise<string> {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = h.get("x-forwarded-proto") ?? (isLocal ? "http" : "https");
  return `${proto}://${host}`;
}

export async function createInviteAction(fd: FormData): Promise<{ url?: string; error?: string }> {
  const maxUses = parseAllowed(fd.get("max_uses"), ALLOWED_USES);
  const hours = parseAllowed(fd.get("expires_in"), ALLOWED_EXPIRY_HOURS);
  if (maxUses === null || hours === null) return { error: "invalid_input" };

  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("create_invite", {
    p_max_uses: maxUses,
    p_expires_in_hours: hours,
  });
  if (error) return { error: rpcErrorCode(error) };

  const code = (data as { code?: string } | null)?.code;
  if (!code) return { error: "unknown" };

  revalidatePath("/invites");
  return { url: `${await siteOrigin()}/invite/${code}` };
}

export async function revokeInviteAction(id: string): Promise<{ error?: string }> {
  if (!UUID_RE.test(id)) return { error: "invalid_input" };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("revoke_invite", { p_invite_id: id, p_reason: null });
  if (error) return { error: rpcErrorCode(error) };
  revalidatePath("/invites");
  return {};
}
