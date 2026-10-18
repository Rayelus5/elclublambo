import { Lock } from "lucide-react";
import { HowItWorksLink } from "@/components/guide/how-it-works-link";
import { DonateButton } from "@/components/treasury/donate-button";
import { lockSituationText, requirementText, type LockState } from "@/lib/channels/lock";

/** Takes the composer's place in a channel the member can read but a DAO post-gate stops them from writing in. */
export function PostGateNotice({ state, chainName }: { state: LockState; chainName: string }) {
  return (
    <section
      aria-label="Escribir en este canal requiere la DAO"
      className="flex flex-col gap-3 border-t border-border bg-surface px-4 py-4"
    >
      <div className="flex items-start gap-3">
        <Lock className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden />
        <div className="flex min-w-0 flex-col gap-1 text-sm">
          <p className="font-semibold text-fg">Para escribir aquí hace falta la DAO.</p>
          {state.requirements.map((r, i) => (
            <p key={r.channelId ?? i} className="text-fg">
              {requirementText(r)}
            </p>
          ))}
          <p className="text-fg-muted">{lockSituationText(state, chainName)}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <DonateButton />
        <HowItWorksLink section="candados" />
      </div>
    </section>
  );
}
