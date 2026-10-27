import { Landmark } from "lucide-react";

/** Shown by every /dao* page while app_config.legacy_dao_enabled is false (the DAO is being rebuilt on Base and Arbitrum). */
export function DaoPaused() {
  return (
    <section
      aria-labelledby="dao-paused-title"
      className="mx-auto flex w-full max-w-xl flex-col items-center gap-3 rounded-panel border border-border bg-surface p-8 text-center"
    >
      <Landmark aria-hidden className="size-8 text-fg-muted" />
      <h1 id="dao-paused-title" className="text-h2">
        La DAO se está rehaciendo
      </h1>
      <p className="text-fg-muted">Pronto podrás donar a ElClub. en Base y Arbitrum.</p>
    </section>
  );
}
