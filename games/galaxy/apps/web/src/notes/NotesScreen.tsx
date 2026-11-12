import { compareVersions, NOTE_KINDS, type NoteKind, type ReleaseNote } from '@galaxy/shared';
import { type CSSProperties, useEffect, useId, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useReleaseNotes } from '../api/notes';
import { copy } from '../copy/es';
import { getPrefs, setPrefs, usePrefs } from '../settings/prefs';
import { useSyncReady } from '../settings/sync';
import { BackLink } from '../ui/BackLink';
import { Icon, type IconName } from '../ui/Icon';
import { useReducedMotion } from '../ui/motion';

// «Notas de versión» (plan «notas de versión»; the owner: «para que los jugadores puedan ver de forma detallada todos
// los cambios que ha habido a lo largo del tiempo, de forma clara, breve y completa»). Every version, newest first,
// with its date, title, summary and changes grouped by kind (each group named, never told by colour alone); an index
// that links to each (`?version=1.3`, a link anyone can share); what is new since the last visit marked «Nueva».
// Opening the page counts the newest as seen (kept with the settings, on the account), which clears the menu's sign;
// on a device that has not heard from the account yet, both wait for it (it may have seen them already).

const t = copy.notes;
const KIND_ICON: Record<NoteKind, IconName> = { nuevo: 'plus', mejora: 'up', equilibrio: 'target', arreglo: 'wrench' };
const longDate = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDate = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dateOf = (d: string, f: Intl.DateTimeFormat) => f.format(new Date(`${d}T00:00:00Z`)).replace('.', '');
/** Each note's place on the page, by its id (two notes may share a version). */
const anchor = (id: string) => `nota-${id}`;

/** The newest version there is (null with none). */
export const newestVersion = (notes: readonly ReleaseNote[]): string | null => notes.reduce<string | null>((top, n) => (top === null || compareVersions(n.version, top) > 0 ? n.version : top), null);

/** Whether a version is newer than the last one seen (all are, before the first visit). */
export const isUnseen = (version: string, seen: string | null) => seen === null || compareVersions(version, seen) > 0;

export function NotesScreen() {
  const notes = useReleaseNotes();
  const [params] = useSearchParams();
  const asked = params.get('version');
  const reduced = useReducedMotion();
  const ready = useSyncReady();
  // What was seen before this visit (once the account has answered), so the page can still mark what is new in it.
  const [seenBefore, setSeenBefore] = useState<string | null | undefined>(undefined);
  const list = notes.data?.notes ?? [];
  const newest = newestVersion(list);
  const seen = usePrefs((p) => p.notesSeen);
  const refs = useRef(new Map<string, HTMLElement>());
  const ids = useId();
  const fresh = (version: string) => seenBefore !== undefined && isUnseen(version, seenBefore);

  // Taken once, the moment the account has answered (during render: it is what this visit starts from).
  if (ready && seenBefore === undefined) setSeenBefore(getPrefs().notesSeen);
  useEffect(() => {
    if (seenBefore !== undefined && newest && isUnseen(newest, seen)) setPrefs({ notesSeen: newest });
  }, [seenBefore, newest, seen]);

  // A version asked for in the address comes into view (and takes the focus, for keyboards and screen readers).
  useEffect(() => {
    if (!asked) return;
    const first = list.find((n) => n.version === asked);
    const el = first ? refs.current.get(first.id) : undefined;
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, list.length, reduced]);

  return (
    <div className="screen-root missions-root">
      <div className="missions notes">
        <header className="collection-bar">
          <BackLink fallback="/" />
          <h1>{t.title}</h1>
        </header>
        <p className="notes-intro">{t.intro}</p>
        {notes.isPending ? (
          <p className="panel-note" role="status">
            {t.loading}
          </p>
        ) : notes.isError ? (
          <p className="panel-note" role="alert">
            {t.error}
          </p>
        ) : list.length === 0 ? (
          <p className="panel-note">{t.empty}</p>
        ) : (
          <div className="notes-body">
            <nav className="notes-index" aria-label={t.index}>
              <ol>
                {list.map((n) => (
                  <li key={n.id}>
                    <Link to={`/notas-de-version?version=${n.version}`} replace className="notes-index-link" aria-current={asked === n.version ? 'true' : undefined}>
                      <b>{t.version(n.version)}</b>
                      <span>{dateOf(n.date, shortDate)}</span>
                      {fresh(n.version) ? (
                        <span className="notes-dot">
                          <span className="sr-only">{t.fresh}</span>
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ol>
            </nav>
            <div className="notes-list">
              {list.map((n, i) => (
                <NoteArticle
                  key={n.id}
                  note={n}
                  index={i}
                  fresh={fresh(n.version)}
                  headingId={`${ids}-${i}`}
                  articleRef={(el) => {
                    if (el) refs.current.set(n.id, el);
                    else refs.current.delete(n.id);
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** One version as the players read it (also the panel editor's preview). */
export function NoteArticle({ note: n, index = 0, fresh = false, headingId, articleRef }: { note: ReleaseNote; index?: number; fresh?: boolean; headingId: string; articleRef?: (el: HTMLElement | null) => void }) {
  return (
    <article ref={articleRef} id={anchor(n.id)} tabIndex={-1} className="lip panel notes-entry" aria-labelledby={headingId} style={{ '--i': index } as CSSProperties}>
      <header className="notes-entry-head">
        <span className="notes-version">{t.version(n.version)}</span>
        {/^\d{4}-\d{2}-\d{2}$/.test(n.date) ? <time dateTime={n.date}>{dateOf(n.date, longDate)}</time> : null}
        {fresh ? <span className="news-tag fresh">{t.fresh}</span> : null}
      </header>
      <h2 id={headingId}>{n.title}</h2>
      {n.summary ? <p className="notes-summary">{n.summary}</p> : null}
      {NOTE_KINDS.map((kind) => {
        const items = n.items.filter((x) => x.kind === kind && x.text.trim());
        if (items.length === 0) return null;
        return (
          <section key={kind} className={`notes-group kind-${kind}`}>
            <h3>
              <Icon name={KIND_ICON[kind]} />
              <span>{t.kinds[kind]}</span>
            </h3>
            <ul>
              {items.map((x, k) => (
                <li key={k}>{x.text}</li>
              ))}
            </ul>
          </section>
        );
      })}
    </article>
  );
}

/** The home menu's pill, with «Nuevo» while the newest version is unseen. */
export function NotesLink({ style }: { style?: CSSProperties }) {
  const notes = useReleaseNotes().data?.notes ?? [];
  const seen = usePrefs((p) => p.notesSeen);
  const ready = useSyncReady();
  const newest = newestVersion(notes);
  // Only once the account has answered: it may have seen them on another device.
  const fresh = ready && !!newest && isUnseen(newest, seen);
  return (
    <Link to="/notas-de-version" className="lip pill enter hub-notes" data-sfx="hover" style={style} aria-label={fresh ? copy.hub.notesFresh : undefined}>
      <Icon name="scroll" />
      <span>{copy.hub.notes}</span>
      {fresh ? (
        <span className="tile-badge hub-notes-badge" aria-hidden="true">
          {copy.hub.notesNew}
        </span>
      ) : null}
    </Link>
  );
}
