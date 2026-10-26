// Estado del sitio (interruptores + mantenimiento). Puro: sin red, sin `server-only`; lo usan el proxy y las páginas.

export const SWITCH_KEYS = [
  "giveaways",
  "pay",
  "checker",
  "vouches",
  "approvals",
  "multisend",
  "gas",
  "donate",
  "checkerApi",
  "registration",
] as const;

export type SwitchKey = (typeof SWITCH_KEYS)[number];
export type ToolKey = Exclude<SwitchKey, "registration">;

export type MaintenanceConfig = {
  enabled: boolean;
  mode: "default" | "custom";
  messageEs: string | null;
  messageEn: string | null;
  returnAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
};

export type SiteState = { switches: Record<SwitchKey, boolean>; maintenance: MaintenanceConfig };

export const OPEN_STATE: SiteState = {
  switches: Object.fromEntries(SWITCH_KEYS.map((k) => [k, true])) as Record<SwitchKey, boolean>,
  maintenance: {
    enabled: false,
    mode: "default",
    messageEs: null,
    messageEn: null,
    returnAt: null,
    startsAt: null,
    endsAt: null,
  },
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === "string" ? v : null);
const date = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(new Date(v).getTime()) ? v : null);

/** Lectura tolerante: solo `false` apaga un interruptor; `enabled` solo es `true` si lo es; una fecha ilegible es null. */
export function parseSiteState(raw: unknown): SiteState {
  if (!isRecord(raw)) return OPEN_STATE;
  const sw = isRecord(raw.switches) ? raw.switches : {};
  const switches = Object.fromEntries(SWITCH_KEYS.map((k) => [k, sw[k] !== false])) as Record<SwitchKey, boolean>;
  const m = isRecord(raw.maintenance) ? raw.maintenance : {};
  return {
    switches,
    maintenance: {
      enabled: m.enabled === true,
      mode: m.mode === "custom" ? "custom" : "default",
      messageEs: text(m.messageEs),
      messageEn: text(m.messageEn),
      returnAt: date(m.returnAt),
      startsAt: date(m.startsAt),
      endsAt: date(m.endsAt),
    },
  };
}

/** A-R11. */
export function isMaintenanceActive(m: MaintenanceConfig, now: number): boolean {
  const starts = m.startsAt === null ? null : new Date(m.startsAt).getTime();
  const ends = m.endsAt === null ? null : new Date(m.endsAt).getTime();
  const on = m.enabled || (starts !== null && now >= starts);
  return on && (ends === null || now < ends);
}

/** A-R8: segundos para `Retry-After`: la vuelta estimada, si no el fin programado (M4), si no una hora. */
export function retryAfterSeconds(m: MaintenanceConfig, now: number): number {
  const back = m.returnAt ?? m.endsAt;
  if (back === null) return 3600;
  const secs = Math.ceil((new Date(back).getTime() - now) / 1000);
  return Math.min(86400, Math.max(60, secs));
}
