// Shared by the actions (validation), the dialog and the queue. Kept out of the "use server" module, which can only
// export async functions.
export const REPORT_REASONS = ["scam", "spam", "abuse", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  scam: "Estafa",
  spam: "Spam",
  abuse: "Acoso o abuso",
  other: "Otro",
};

export const REPORT_NOTE_MAX = 500;

export const isReportReason = (v: unknown): v is ReportReason =>
  typeof v === "string" && (REPORT_REASONS as readonly string[]).includes(v);
