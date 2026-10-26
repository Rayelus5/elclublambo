// Decisión de la puerta del proxy: 404 de /status, mantenimiento e interruptores de herramienta. Pura.
import { isMaintenanceBypass, isStatusPath, toolForPath } from "./paths";
import { isMaintenanceActive, type SiteState } from "./state";

export type GateInput = {
  pathname: string;
  method: string;
  rsc: boolean;
  state: SiteState;
  now: number;
  access: "superadmin" | "granted" | "none";
};

export type GateDecision =
  | { kind: "pass"; banner: boolean }
  | { kind: "status404" }
  | { kind: "maintenancePage" }
  | { kind: "maintenanceJson" }
  | { kind: "unavailablePage" }
  | { kind: "unavailableJson" };

const isApi = (p: string) => p === "/api" || p.startsWith("/api/");

export function gateDecision(i: GateInput): GateDecision {
  if (isStatusPath(i.pathname)) return { kind: "status404" };

  const active = isMaintenanceActive(i.state.maintenance, i.now);
  const read = i.method === "GET" || i.method === "HEAD";
  if (active && !isMaintenanceBypass(i.pathname) && i.access === "none") {
    return read && !isApi(i.pathname) ? { kind: "maintenancePage" } : { kind: "maintenanceJson" };
  }

  const tool = toolForPath(i.pathname);
  if (tool !== null && !i.state.switches[tool]) {
    if (isApi(i.pathname)) return { kind: "unavailableJson" };
    if (read && !i.rsc) return { kind: "unavailablePage" };
  }

  return { kind: "pass", banner: active && i.access !== "none" };
}
