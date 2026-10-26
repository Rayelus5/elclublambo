import { connection, NextResponse, type NextRequest } from "next/server";
import { verifyPassword, PASSWORD_MAX } from "@/lib/admin/password";
import { getSiteState } from "@/lib/admin/site-state";
import { isMaintenanceActive } from "@/lib/admin/state";
import { isSuperAdminWallet, walletFromUser } from "@/lib/auth/wallet";
import { hitRateLimit } from "@/lib/rate-limit";
import { hitIpRateLimit } from "@/lib/rate-limit/ip";
import { safeError } from "@/lib/security/redact";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

// POST /api/team-access — «Acceso del equipo» durante el mantenimiento (A-R4, A-R6, A-R7, A-R10, A-R19).
// Sin `password`: dice en qué punto está la sesión. Con `password`: cobra los dos golpes antes de mirar nada y, si la
// contraseña es buena, guarda el acceso (fila en `maintenance_grants`). La contraseña y el hash nunca salen de aquí.

type Status =
  | "off"
  | "not_signed_in"
  | "superadmin"
  | "granted"
  | "needs_password"
  | "not_listed"
  | "wrong_password"
  | "invalid"
  | "rate_limited"
  | "error";

const HEADERS = { "Cache-Control": "no-store" };

function reply(status: Status, code = 200): NextResponse {
  return NextResponse.json({ status }, { status: code, headers: HEADERS });
}

/** Un log con solo el código del error; por si acaso, sin ningún secreto dentro. */
function logError(step: string, e: unknown, secrets: string[]): void {
  let text = safeError(e);
  for (const s of secrets) if (s) text = text.split(s).join("***");
  console.error("[team-access] failed", step, text);
}

/** Lee `{ password?: string }`. undefined = sin contraseña; null = cuerpo inválido. */
async function readPassword(request: NextRequest): Promise<string | undefined | null> {
  const raw = await request.text();
  if (raw.trim() === "") return undefined;
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  if (!("password" in body)) return undefined;
  const { password } = body as { password: unknown };
  if (typeof password !== "string" || password.length < 1 || password.length > PASSWORD_MAX) return null;
  return password;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  await connection();
  if (request.headers.get("sec-fetch-site") !== "same-origin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: HEADERS });
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return reply("not_signed_in", 401);

  const state = await getSiteState();
  if (!isMaintenanceActive(state.maintenance, Date.now())) return reply("off");

  const password = await readPassword(request);
  if (password === null) return reply("invalid", 400);
  const secrets = password === undefined ? [] : [password];

  /** A-R6: la wallet de SUPER_ADMIN_WALLET entra sin BD; si no, my_maintenance_access (null = error). */
  const myAccess = async (): Promise<string | null> => {
    const wallet = walletFromUser(user);
    if (wallet !== null && isSuperAdminWallet(wallet, process.env.SUPER_ADMIN_WALLET)) return "superadmin";
    try {
      const { data, error } = await supabase.rpc("my_maintenance_access");
      if (error || typeof data !== "string") {
        logError("access", error?.message ?? "unexpected", secrets);
        return null;
      }
      return data;
    } catch (e) {
      logError("access", e, secrets);
      return null;
    }
  };

  if (password === undefined) {
    const access = await myAccess();
    if (access === "superadmin" || access === "granted") return reply(access);
    if (access === "listed") return reply("needs_password");
    if (access === "none") return reply("not_listed");
    return reply("error", 503);
  }

  // A-R10: los golpes se cobran antes de mirar la lista o el hash.
  const hits = await Promise.all([
    hitIpRateLimit("maintenance_password", request.headers),
    hitRateLimit(supabase, "maintenance_password"),
  ]);
  if (hits.includes("rate_limited")) return reply("rate_limited", 429);
  if (hits.includes("error")) return reply("error", 503);

  const access = await myAccess();
  if (access === null) return reply("error", 503);
  if (access === "superadmin" || access === "granted") return reply(access);
  if (access !== "listed") return reply("not_listed");

  try {
    const admin = createAdminClient();
    const record = await admin.rpc("maintenance_password_record");
    if (record.error) {
      logError("record", record.error.message, secrets);
      return reply("error", 503);
    }
    const data = record.data as { hash?: unknown; version?: unknown } | null;
    if (data === null) return reply("wrong_password");
    if (typeof data.hash !== "string" || typeof data.version !== "number") {
      logError("record", "unexpected", secrets);
      return reply("error", 503);
    }
    secrets.push(data.hash);
    if (!(await verifyPassword(password, data.hash))) return reply("wrong_password");

    const grant = await admin.rpc("grant_maintenance_access", {
      p_auth_user_id: user.id,
      p_password_version: data.version,
    });
    if (grant.error) {
      logError("grant", grant.error.message, secrets);
      return reply("error", 503);
    }
    switch (grant.data) {
      case "granted":
        return reply("granted");
      case "stale":
        // La contraseña cambió entre la lectura y la concesión.
        return reply("wrong_password");
      case "not_listed":
        return reply("not_listed");
      case "expired":
        // El mantenimiento acaba ya (endsAt pasado): no queda nada que abrir.
        return reply("off");
      default:
        logError("grant", "unexpected", secrets);
        return reply("error", 503);
    }
  } catch (e) {
    logError("check", e, secrets);
    return reply("error", 503);
  }
}
