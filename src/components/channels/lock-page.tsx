import { Folder, Hash, Lock } from "lucide-react";
import { HowItWorksLink } from "@/components/guide/how-it-works-link";
import { lockSituationText, requirementText, type LockState } from "@/lib/channels/lock";

/**
 * What a member sees at /c/<id> when a DAO view-gate locks the channel they would otherwise see. It carries only the
 * channel's name and kind plus the requirement and the member's own standing: no topic, messages, pins or members.
 */
export function LockPage({ state, chainName }: { state: LockState; chainName: string }) {
  const Icon = state.kind === "text" ? Hash : Folder;
  const many = state.requirements.length > 1;
  return (
    <div className="flex max-w-xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <span className="inline-flex items-center gap-2 text-[13px] font-semibold tracking-wide text-fg-muted uppercase">
          <Lock className="size-4" aria-hidden />
          Canal con candado
        </span>
        <h1 className="text-h1">
          <Icon className="mr-2 inline size-6 align-[-0.1em] text-fg-muted" aria-hidden />
          {state.name}
        </h1>
      </header>

      <section aria-labelledby="lock-req" className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-5">
        <h2 id="lock-req" className="text-h2">
          {many ? "Requisitos" : "Requisito"}
        </h2>
        <ul className="flex flex-col gap-2">
          {state.requirements.map((r, i) => (
            <li key={r.channelId ?? i} className="text-fg">
              {requirementText(r)}
            </li>
          ))}
        </ul>
        {many ? <p className="text-sm text-fg-muted">Tienes que cumplir todos los requisitos para entrar.</p> : null}
        <p className="border-t border-border pt-3 text-sm text-fg-muted">{lockSituationText(state, chainName)}</p>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <HowItWorksLink section="candados" />
      </div>
    </div>
  );
}
