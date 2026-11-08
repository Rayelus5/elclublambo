import { useState } from 'react';
import { copy } from '../copy/es';
import { BackLink } from '../ui/BackLink';
import { Icon } from '../ui/Icon';

// The Guía (GDD §12.2; M7c, DESIGN_SYSTEM §8 octovicies): chapters to read at any time, each with a small animated
// example (CSS; still with reduced motion). Short: what to do, never a wall of text.

const t = copy.guide;
type Chapter = keyof typeof t.chapters;
const CHAPTERS = Object.keys(t.chapters) as Chapter[];

/** A small looping example for each chapter, drawn with CSS. */
function Demo({ chapter }: { chapter: Chapter }) {
  return (
    <div className={`guide-demo demo-${chapter}`} aria-hidden="true">
      {chapter === 'run' ? (
        <>
          <i className="probe" />
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <i key={n} className="foe" style={{ ['--n' as string]: n }} />
          ))}
          <i className="ring" />
        </>
      ) : chapter === 'upgrades' ? (
        [0, 1, 2].map((n) => <i key={n} className="pick" style={{ ['--n' as string]: n }} />)
      ) : chapter === 'layers' ? (
        <>
          <i className="beacon" />
          <i className="beacon-fill" />
          <i className="probe" />
        </>
      ) : chapter === 'galaxies' ? (
        <i className="card" />
      ) : chapter === 'station' ? (
        <>
          <i className="bar" />
          <i className="bar-fill" />
        </>
      ) : (
        [0, 1, 2].map((n) => <i key={n} className="bubble" style={{ ['--n' as string]: n }} />)
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
