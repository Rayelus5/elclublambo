import { PageLoader } from "@/components/shell/page-loader";

/** Shown while a channel and its message history load. Placeholder until the history skeleton (T-004) replaces it. */
export function ChatHistoryLoading() {
  return <PageLoader label="Cargando mensajes…" />;
}
