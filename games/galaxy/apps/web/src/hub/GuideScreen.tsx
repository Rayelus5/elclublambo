import { useState } from 'react';
import { copy } from '../copy/es';
import { BackLink } from '../ui/BackLink';
import { Icon } from '../ui/Icon';

// The Guía (GDD §12.2; M7c, DESIGN_SYSTEM §8 octovicies): chapters to read at any time, each with a small animated
// example (CSS; still with reduced motion). Short: what to do, never a wall of text.

const t = copy.guide;
type Chapter = keyof typeof t.chapters;
const CHAPTERS = Object.keys(t.chapters) as Chapter[];

const n = (k: number) => ({ ['--n' as string]: k }) as React.CSSProperties;

/** A small looping example for each chapter, drawn with CSS (still with reduced motion). */
function Demo({ chapter }: { chapter: Chapter }) {
  return (
    <div className={`guide-demo demo-${chapter}`} aria-hidden="true">
      <i className="stars" />
      {chapter === 'run' ? (
        <>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((k) => (
            <i key={`f${k}`} className="foe" style={n(k)} />
          ))}
          {[0, 1, 2, 3, 4, 5, 6, 7].map((k) => (
            <i key={`g${k}`} className="gem" style={n(k)} />
          ))}
          <i className="orbit">
            <i className="orb" />
            <i className="orb two" />
          </i>
          <i className="probe" />
        </>
      ) : chapter === 'upgrades' ? (
        <>
          {[0, 1, 2].map((k) => (
            <i key={k} className={`pick p${k}`} style={n(k)}>
              <i className="glyph" />
            </i>
          ))}
          <i className="levelup" />
        </>
      ) : chapter === 'layers' ? (
        <>
          <i className="core" />
          <i className="beacon" />
          <i className="beacon-fill" />
          <i className="probe walker" />
        </>
      ) : chapter === 'galaxies' ? (
        <i className="card">
          <i className="spiral" />
          <i className="sheen" />
        </i>
      ) : chapter === 'station' ? (
        <>
          {[0, 1, 2].map((k) => (
            <i key={k} className="room" style={n(k)}>
              <i className="bar-fill" />
            </i>
          ))}
          <i className="gear" />
        </>
      ) : (
        <>
          {[0, 1, 2, 3].map((k) => (
            <i key={k} className={`bubble${k % 2 ? ' right' : ''}`} style={n(k)} />
          ))}
          <i className="emblem" />
        </>
      )}
    </div>
  );
}

export function GuideScreen() {
  const [chapter, setChapter] = useState<Chapter>('run');
  const c = t.chapters[chapter];
  return (
    <div className="screen-root missions-root">
      <div className="missions guide">
        <header className="collection-bar">
          <BackLink fallback="/">
            <Icon name="back" />
            <span>{t.back}</span>
          </BackLink>
          <h1>{t.title}</h1>
        </header>
        <div className="guide-body">
          <ul className="guide-list" aria-label={t.chaptersLabel}>
            {CHAPTERS.map((k) => (
              <li key={k}>
                <button type="button" className="guide-item" aria-pressed={chapter === k} onClick={() => setChapter(k)}>
                  <Icon name="book" />
                  <span>{t.chapters[k].title}</span>
                </button>
              </li>
            ))}
          </ul>
          <article className="lip panel guide-entry" aria-labelledby="guide-title">
            <h2 id="guide-title">{c.title}</h2>
            <Demo chapter={chapter} />
            <ul className="guide-points">
              {c.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </article>
        </div>
      </div>
    </div>
  );
}
