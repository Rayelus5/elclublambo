// Textos de la pestaña «Administración»: nombres de los interruptores y frases del historial.
import { shortAddress } from "@/lib/auth/wallet";
import { SWITCH_KEYS, type SwitchKey } from "./state";

export const SWITCH_LABELS: Record<SwitchKey, string> = {
  giveaways: "Sorteos verificables",
  pay: "ElClub Pay",
  checker: "Comprobador",
  vouches: "Avales",
  approvals: "Aprobaciones",
  multisend: "Envío múltiple (incluye «Repartir gastos»)",
  gas: "Gas",
  donate: "Donar público",
  checkerApi: "API del comprobador",
  registration: "Registro de cuentas públicas",
};

const isSwitchKey = (v: unknown): v is SwitchKey => typeof v === "string" && (SWITCH_KEYS as readonly string[]).includes(v);
const isWallet = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);

/** Una línea del historial a partir de la fila de `audit_log`. Lo que no se entiende se muestra con su código. */
export function describeAdminAction(action: string, payload: Record<string, unknown>): string {
  switch (action) {
    case "admin.switch":
      if (!isSwitchKey(payload.key) || typeof payload.enabled !== "boolean") return action;
      return `${payload.enabled ? "Activó" : "Desactivó"} «${SWITCH_LABELS[payload.key]}»`;
    case "admin.maintenance":
      if (payload.enabled === true) return "Activó el mantenimiento";
      if (typeof payload.startsAt === "string") return "Programó el mantenimiento";
      return "Desactivó el mantenimiento";
    case "admin.maintenance_password":
      return "Cambió la contraseña de mantenimiento";
    case "admin.access_add":
      return isWallet(payload.wallet) ? `Añadió ${shortAddress(payload.wallet)} a la lista de acceso` : action;
    case "admin.access_remove":
      return isWallet(payload.wallet) ? `Quitó ${shortAddress(payload.wallet)} de la lista de acceso` : action;
    default:
      return action;
  }
}
