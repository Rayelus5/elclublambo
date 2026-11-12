import type { PulledGalaxy } from '@galaxy/shared';
import type { ReactNode } from 'react';
import { ClassicStage } from './ClassicStage';
import { ProShell } from './pro/ProShell';
import type { Intro } from './pro/script';
import { useRevealMode } from './useRevealMode';

// A scan's or a fusion's reveal (GDD §9): the pro cinematic or the classic CRT (plan «escáner pro», part B, and plan
// «fusión pro»; useRevealMode decides). The pro one opens while the request is still out (`pulls` null: the bands
// close at once); the classic one only once the galaxies are here. Both end in the same summary with the same buttons.

export function RevealStage({
  pulls,
  onClose,
  actions,
  status,
  failed,
  onAbort,
  summaryOnly,
  title,
  intro,
  inputs,
}: {
  pulls: readonly PulledGalaxy[] | null;
  title?: string;
  /** A fusion opens with its galaxies going in (the pro cinematic only). */
  intro?: Intro;
  inputs?: readonly PulledGalaxy[];
  onClose: () => void;
  /** Extra buttons in the summary («¡Escanear otra!», «Colección»…). */
  actions?: ReactNode;
  /** A line over the summary's buttons: what is missing to scan again, or why it failed. */
  status?: ReactNode;
  failed?: boolean;
  onAbort?: () => void;
  summaryOnly?: boolean;
}) {
  const mode = useRevealMode();
  if (mode === 'pro') return <ProShell pulls={pulls} title={title} intro={intro} inputs={inputs} onClose={onClose} actions={actions} status={status} failed={failed} onAbort={onAbort} summaryOnly={summaryOnly} />;
  // A new scan from the summary starts its own reveal (its steps, images and focus).
  return pulls ? <ClassicStage key={pulls[0]?.id ?? 'none'} pulls={pulls} title={title} onClose={onClose} actions={actions} status={status} /> : null;
}
