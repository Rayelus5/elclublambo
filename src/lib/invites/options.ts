export const USES_OPTIONS = [
  { value: 1, label: "1 uso" },
  { value: 5, label: "5 usos" },
  { value: 10, label: "10 usos" },
  { value: 25, label: "25 usos" },
  { value: 100, label: "100 usos" },
] as const;

/** Value = hours sent to create_invite(p_expires_in_hours). */
export const EXPIRY_OPTIONS = [
  { value: 1, label: "1 hora" },
  { value: 24, label: "24 horas" },
  { value: 168, label: "7 días" },
  { value: 720, label: "30 días" },
] as const;

export const ALLOWED_USES: readonly number[] = USES_OPTIONS.map((o) => o.value);
export const ALLOWED_EXPIRY_HOURS: readonly number[] = EXPIRY_OPTIONS.map((o) => o.value);
