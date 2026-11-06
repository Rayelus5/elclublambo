import { TRAITS } from '@galaxy/engine';
import type { PulledGalaxy } from '@galaxy/shared';
import { useEffect, useState, type CSSProperties } from 'react';
import { copy } from '../copy/es';
import { loadRender } from '../galaxy/images';

// The back of a galaxy card (GDD §8.1): the galaxy's own braille transcription at 48 columns, embossed, and its traits.
// The braille is the engine's text for that seed, so it is the same galaxy as the front, dot for dot.
const traitValue = (key: string, value: string): string =>
  (copy.traitValues as Record<string, Record<string, string> | undefined>)[key]?.[value] ?? value;

export function CardBack({ galaxy, size = 300 }: { galaxy: PulledGalaxy; size?: number }) {
  const [braille, setBraille] = useState<{ seed: string; text: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadRender(BigInt(galaxy.seed), 48, controller.signal).then(
      (render) => setBraille({ seed: galaxy.seed, text: render.text }),
      () => {},
    );
    return () => controller.abort();
  }, [galaxy.seed]);

  const text = braille?.seed === galaxy.seed ? braille.text : null;
  const traits = TRAITS.drawOrder.filter((k) => galaxy.traits[k] !== undefined);
  return (
    <article className="gcard gcard-back" data-tier={galaxy.tier} aria-label={copy.card.back(galaxy.name)} style={{ '--w': `${size}px` } as CSSProperties}>
      <div className="gcard-face">
        <figure className="gcard-relief">
          <pre className="relief" aria-hidden="true">
            {text ?? '⠋⠙⠹'}
          </pre>
          <figcaption className="sr-only">{copy.card.braille(galaxy.name)}</figcaption>
        </figure>
        <dl className="gcard-traits">
          {traits.map((k) => (
            <div key={k}>
              <dt>{copy.traitNames[k]}</dt>
              <dd>{traitValue(k, galaxy.traits[k]!)}</dd>
            </div>
          ))}
        </dl>
        <p className="gcard-back-name">
          <b>{galaxy.name}</b>
          <span>{galaxy.designation}</span>
        </p>
      </div>
    </article>
  );
}
