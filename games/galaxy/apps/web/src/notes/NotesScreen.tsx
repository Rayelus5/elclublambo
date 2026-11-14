import { compareVersions, NOTE_KINDS, type NoteKind, noteShelf, type ReleaseNote } from '@galaxy/shared';
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
// los cambios que ha habido a lo largo del tiempo, de forma clara, breve y completa»). One version at a time, with its
// date, title, summary and changes grouped by kind (each group named, never told by colour alone), and the way to the
// one before and after. The index, by categories (the owner, 2026-11-14: «se ven demasiadas versiones»): «BETA» for
// the open beta's 1.x, then from 2027 each year and its months (v27.01…), newest on top, each opening and closing, the
// one with the version shown open. Every version has its link (`?version=1.3`, anyone can share it); what is new since
// the last visit marked «Nueva».
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

/** A category of the index: «BETA», or a year with its months, each with its notes (newest first). */
export interface Shelf {
  key: string;
  label: string;
  notes: ReleaseNote[];
  months?: { key: string; label: string; notes: ReleaseNote[] }[];
}

/** The notes (newest first) by categories, newest on top: each year from 2027 with its months, then «BETA». */
export function shelves(notes: readonly ReleaseNote[]): Shelf[] {
  const years = new Map<number, Map<number, ReleaseNote[]>>();
  const beta: ReleaseNote[] = [];
  for (const n of notes) {
    const s = noteShelf(n);
    if (s.kind === 'beta') beta.push(n);
    else {
      const months = years.get(s.year) ?? new Map<number, ReleaseNote[]>();
      years.set(s.year, months);
      months.set(s.month, [...(months.get(s.month) ?? []), n]);
    }
  }
  const out: Shelf[] = [...years.entries()]
    .sort(([a], [b]) => b - a)
    .map(([year, months]) => {
      const list = [...months.entries()].sort(([a], [b]) => b - a);
      return {
        key: `y${year}`,
        label: String(year),
        notes: list.flatMap(([, ns]) => ns),
        months: list.map(([m, ns]) => ({ key: `y${year}-${m}`, label: t.months[m - 1]!, notes: ns })),
      };
    });
  if (beta.length > 0) out.push({ key: 'beta', label: t.beta, notes: beta });
  return out;
}

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
  // The version shown: the one the address asks for, else the newest.
  const at = Math.max(0, asked ? list.findIndex((n) => n.version === asked) : 0);
  const shown = list[at];
  const tree = shelves(list);
  // Which categories are open: the player's choice, else those holding the version shown.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const isOpen = (key: string, notes: readonly ReleaseNote[]) => toggled[key] ?? notes.some((n) => n.id === shown?.id);
  const flip = (key: string, notes: readonly ReleaseNote[]) => setToggled((o) => ({ ...o, [key]: !isOpen(key, notes) }));

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
    el.scrollIntoView?.({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
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
              <ul className="notes-tree">
                {tree.map((shelf) => (
                  <li key={shelf.key}>
                    <ShelfButton shelf={shelf} open={isOpen(shelf.key, shelf.notes)} onClick={() => flip(shelf.key, shelf.notes)} fresh={shelf.notes.some((n) => fresh(n.version))} controls={`${ids}-${shelf.key}`} />
                    {isOpen(shelf.key, shelf.notes) ? (
                      shelf.months ? (
                        <ul id={`${ids}-${shelf.key}`} className="notes-months">
                          {shelf.months.map((m) => (
                            <li key={m.key}>
                              <ShelfButton shelf={m} open={isOpen(m.key, m.notes)} onClick={() => flip(m.key, m.notes)} fresh={m.notes.some((n) => fresh(n.version))} controls={`${ids}-${m.key}`} small />
                              {isOpen(m.key, m.notes) ? <Versions id={`${ids}-${m.key}`} notes={m.notes} shown={shown} fresh={fresh} /> : null}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <Versions id={`${ids}-${shelf.key}`} notes={shelf.notes} shown={shown} fresh={fresh} />
                      )
                    ) : null}
                  </li>
                ))}
              </ul>
            </nav>
            <div className="notes-list">
              {shown ? (
                <NoteArticle
                  key={shown.id}
                  note={shown}
                  fresh={fresh(shown.version)}
                  headingId={`${ids}-shown`}
                  articleRef={(el) => {
                    if (el) refs.current.set(shown.id, el);
                    else refs.current.delete(shown.id);
                  }}
                />
              ) : null}
              <div className="notes-pager">
                {list[at + 1] ? (
                  <Link className="lip pill small" to={`/notas-de-version?version=${list[at + 1]!.version}`} replace>
                    <Icon name="back" />
                    <span>{t.older}</span>
                    <small>{t.version(list[at + 1]!.version)}</small>
                  </Link>
                ) : (
                  <span />
                )}
                {at > 0 ? (
                  <Link className="lip pill small" to={`/notas-de-version?version=${list[at - 1]!.version}`} replace>
                    <span>{t.newer}</span>
                    <small>{t.version(list[at - 1]!.version)}</small>
                    <Icon name="next" />
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** A category's button in the index: its name, how many versions, and a dot when one is new. */
function ShelfButton({ shelf, open, onClick, fresh, controls, small = false }: { shelf: { label: string; notes: ReleaseNote[] }; open: boolean; onClick: () => void; fresh: boolean; controls: string; small?: boolean }) {
  return (
    <button type="button" className={`notes-shelf${small ? ' month' : ''}`} aria-expanded={open} aria-controls={controls} onClick={onClick}>
      <Icon name={open ? 'down' : 'next'} />
      <b>{shelf.label}</b>
      <small>{t.shelfCount(shelf.notes.length)}</small>
      {fresh ? (
        <span className="notes-dot">
          <span className="sr-only">{t.shelfFresh}</span>
        </span>
      ) : null}
    </button>
  );
}

/** A category's versions, each its link (the one shown marked). */
function Versions({ id, notes, shown, fresh }: { id: string; notes: ReleaseNote[]; shown: ReleaseNote | undefined; fresh: (v: string) => boolean }) {
  return (
    <ol id={id} className="notes-versions">
      {notes.map((n) => (
        <li key={n.id}>
          <Link to={`/notas-de-version?version=${n.version}`} replace className="notes-index-link" aria-current={shown?.id === n.id ? 'page' : undefined}>
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
