import type { CoopRunStart } from '@galaxy/shared';
import type { CSSProperties } from 'react';
import { probeDrawing, spriteDataUrl } from '../arena/sprites';
import { BIOME_LOOK } from '../arena/stage/biomes';
import { copy } from '../copy/es';

// The short loading screen before a group run (the owner, 2026-11-14): instead of a line of text, the sector in its
// biome's colours, the team with their probes (each in its skin), and the three steps with a bar. It stays at least a
// moment (MIN_MS, never a flash) and fades out once the arena is drawn and caught up. A status for screen readers;
// with reduced motion nothing moves.

const t = copy.coop.loading;

export type LoadingStep = 'connect' | 'arena' | 'sync' | 'done';
const STEPS: Exclude<LoadingStep, 'done'>[] = ['connect', 'arena', 'sync'];
/** The least it shows, and how long its fade lasts (ms). */
export const LOADING_MIN_MS = 1200;
export const LOADING_FADE_MS = 300;

export function CoopLoading({ start, step, leaving = false }: { start: CoopRunStart | null; step: LoadingStep; leaving?: boolean }) {
  const sector = start?.content.sectors.find((s) => s.id === start.sector) ?? null;
  const look = BIOME_LOOK[sector?.biome ?? 'nebula'];
  const at = step === 'done' ? STEPS.length : STEPS.indexOf(step);
  const style = { '--biome-a': look.nebula[0], '--biome-b': look.nebula[2], '--biome-glow': look.dust, '--p': `${Math.round(((at + (step === 'done' ? 0 : 0.5)) / STEPS.length) * 100)}%` } as CSSProperties;
  return (
    <div className={`coop-loading${leaving ? ' leaving' : ''}`} style={style} role="status" aria-busy={step !== 'done'} aria-label={t.label}>
      <div className="coop-loading-card">
        <p className="coop-loading-kicker">{t.kicker}</p>
        <h2 className="coop-loading-sector">{sector?.name ?? t.unknown}</h2>
        {start ? (
          <ul className="coop-loading-team" aria-label={t.team}>
            {start.players.map((p, i) => {
              const def = start.content.probes.find((d) => d.id === p.probe);
              return (
                <li key={p.username} className={i === start.slot ? 'me' : undefined} style={{ '--i': i } as CSSProperties}>
                  {def ? <img src={spriteDataUrl(probeDrawing(p.skin, def.sprite), 4)} alt="" width={64} height={64} draggable={false} /> : null}
                  <b>{i === start.slot ? t.you : p.username}</b>
                  <small>{def?.name ?? p.probe}</small>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="coop-loading-team empty" aria-hidden="true" />
        )}
        <ol className="coop-loading-steps">
          {STEPS.map((s, k) => (
            <li key={s} className={k < at ? 'done' : k === at ? 'now' : undefined} aria-current={k === at ? 'step' : undefined}>
              {t.steps[s]}
            </li>
          ))}
        </ol>
        <div className="coop-loading-bar" aria-hidden="true">
          <i />
        </div>
      </div>
    </div>
  );
}
