import { type AdminReleaseNote, compareVersions, NOTE_KINDS, type NoteKind, type ReleaseNote } from '@galaxy/shared';
import { useId, useState } from 'react';
import { type NoteAction, useAdminNotes, useNoteChange } from '../api/notes';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { NoteArticle, newestVersion } from '../notes/NotesScreen';
import { DateField } from '../ui/DateField';
import { Dialog } from '../ui/Dialog';
import { HScroll } from '../ui/HScroll';
import { Icon } from '../ui/Icon';
import { Select } from '../ui/Select';

// «Notas de versión» in the panel (plan «notas de versión»; the owner chose «las dos cosas»: the notes come with each
// change, in the code, and here the admin adds new ones or corrects them without a deploy). Every note with where it
// comes from, whether the players see it, and whether another visible note has its version. «Nueva nota» and
// «Editar» open the same editor — version, date, title, summary and the changes, each with its kind, to add, move and
// remove — with a preview exactly as the players read it. A new note never takes an existing one's id. Hiding and
// showing again keep a correction; a corrected note of the game can go back to the game's text; the game's notes are
// never deleted, the panel's own are, after a confirmation. Admins only; each change is audited by the server.

const t = copy.admin.notes;
type Item = { key: number; kind: NoteKind; text: string };
type Draft = { id: string | null; version: string; date: string; title: string; summary: string; items: Item[] };
let keys = 0;
const item = (kind: NoteKind, text: string): Item => ({ key: ++keys, kind, text });

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const nextVersion = (v: string | null) => {
  if (!v) return '1.0';
  const [major = 1, minor = 0] = v.split('.').map(Number);
  return `${major}.${minor + 1}`;
};
/** A new note's id: its version and title, as a slug (`v1-6-la-nota`). */
export function noteId(version: string, title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return `v${version.replace('.', '-')}${slug ? `-${slug}` : ''}`;
}

const valid = (d: Draft) => /^\d{1,3}\.\d{1,3}$/.test(d.version) && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && d.title.trim().length > 0 && d.items.some((x) => x.text.trim());

/** A new note's id, made free of the ones there are (`-2`, `-3`… after it). */
function freeId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function Editor({ draft: initial, taken, onClose }: { draft: Draft; taken: ReadonlySet<string>; onClose: () => void }) {
  const ids = useId();
  const [d, setD] = useState(initial);
  const { save, create } = useNoteChange();
  const busy = save.isPending || create.isPending;
  const failed = save.error ?? create.error;
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const setItem = (i: number, patch: Partial<Draft['items'][number]>) => set({ items: d.items.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  const move = (i: number, by: -1 | 1) => {
    const items = [...d.items];
    const [it] = items.splice(i, 1);
    items.splice(i + by, 0, it!);
    set({ items });
  };
  const note: ReleaseNote = { id: d.id ?? freeId(noteId(d.version, d.title), taken), version: d.version.trim(), date: d.date, title: d.title.trim(), summary: d.summary.trim(), items: d.items.filter((x) => x.text.trim()).map((x) => ({ kind: x.kind, text: x.text.trim() })) };
  const title = initial.id ? t.editOf(initial.version) : t.create;
  const field = (k: 'version' | 'title' | 'summary', max: number) => (
    <div className="field">
      <label htmlFor={`${ids}-${k}`}>{t.fields[k]}</label>
      <div className="control">
        <input id={`${ids}-${k}`} type="text" autoComplete="off" maxLength={max} value={d[k]} onChange={(e) => set({ [k]: e.target.value })} />
      </div>
    </div>
  );
  return (
    <Dialog title={title} onClose={onClose} className="notes-editor" closeOnVeil={false}>
      <form
        className="notes-editor-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid(d) || busy) return;
          const { id, ...rest } = note;
          if (initial.id) save.mutate({ id, note: rest }, { onSuccess: onClose });
          else create.mutate(note, { onSuccess: onClose });
        }}
      >
        <div className="notes-editor-form">
          <div className="notes-editor-row">
            {field('version', 7)}
            <div className="field">
              <label htmlFor={`${ids}-date`}>{t.fields.date}</label>
              <div className="control">
                <DateField id={`${ids}-date`} value={d.date} onChange={(v) => set({ date: v.slice(0, 10) })} />
              </div>
            </div>
          </div>
          {field('title', 80)}
          {field('summary', 280)}
          <fieldset className="notes-editor-items">
            <legend>{t.items}</legend>
            <ol>
              {d.items.map((x, i) => (
                <li key={x.key} className="notes-editor-item">
                  <Select<NoteKind> aria-label={t.itemKind(i + 1)} size="sm" value={x.kind} options={NOTE_KINDS.map((k) => ({ value: k, label: copy.notes.kinds[k] }))} onChange={(kind) => setItem(i, { kind })} />
                  <textarea aria-label={t.itemText(i + 1)} rows={2} maxLength={280} value={x.text} onChange={(e) => setItem(i, { text: e.target.value })} />
                  <span className="notes-editor-tools">
                    <button type="button" className="lip iconbtn" aria-label={t.up(i + 1)} title={t.up(i + 1)} disabled={i === 0} onClick={() => move(i, -1)}>
                      <Icon name="up" />
                    </button>
                    <button type="button" className="lip iconbtn" aria-label={t.down(i + 1)} title={t.down(i + 1)} disabled={i === d.items.length - 1} onClick={() => move(i, 1)}>
                      <Icon name="down" />
                    </button>
                    <button type="button" className="lip iconbtn" aria-label={t.remove(i + 1)} title={t.remove(i + 1)} disabled={d.items.length === 1} onClick={() => set({ items: d.items.filter((_, k) => k !== i) })}>
                      <Icon name="trash" />
                    </button>
                  </span>
                </li>
              ))}
            </ol>
            <button type="button" className="lip pill small" disabled={d.items.length >= 40} onClick={() => set({ items: [...d.items, item(d.items.at(-1)?.kind ?? 'nuevo', '')] })}>
              <Icon name="plus" />
              <span>{t.addItem}</span>
            </button>
          </fieldset>
          {failed ? (
            <p className="field-error" role="alert">
              {errorText(failed, copy.errors)}
            </p>
          ) : null}
          <div className="modal-actions">
            <button type="button" className="lip pill" onClick={onClose}>
              {t.cancel}
            </button>
            <button type="submit" className="lip pill pill-solar" disabled={!valid(d) || busy} aria-busy={busy || undefined}>
              {busy ? t.saving : t.save}
            </button>
          </div>
        </div>
        <section className="notes-editor-preview" aria-label={t.preview}>
          <h3>{t.preview}</h3>
          <NoteArticle note={note} headingId={`${ids}-preview`} />
        </section>
      </form>
    </Dialog>
  );
}

const draftOf = (n: AdminReleaseNote): Draft => ({ id: n.id, version: n.version, date: n.date, title: n.title, summary: n.summary, items: n.items.map((x) => item(x.kind, x.text)) });

export function NotesAdmin() {
  const notes = useAdminNotes();
  const { act } = useNoteChange();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<AdminReleaseNote | null>(null);
  const list = [...(notes.data?.notes ?? [])].sort((a, b) => compareVersions(b.version, a.version));
  const run = (n: AdminReleaseNote, action: NoteAction) => act.mutate({ id: n.id, action });
  return (
    <section className="admin-page notes-admin">
      <h1>{t.title}</h1>
      <p className="panel-note">{t.intro}</p>
      <div className="notes-admin-tools">
        <button type="button" className="lip pill pill-solar" aria-haspopup="dialog" onClick={() => setEditing({ id: null, version: nextVersion(newestVersion(list)), date: today(), title: '', summary: '', items: [item('nuevo', '')] })}>
          <Icon name="plus" />
          <span>{t.create}</span>
        </button>
      </div>
      {act.error ? (
        <p className="field-error" role="alert">
          {errorText(act.error, copy.errors)}
        </p>
      ) : null}
      {notes.isError ? (
        <p className="field-error" role="alert">
          {errorText(notes.error, copy.errors)}
        </p>
      ) : null}
      {notes.data && list.length === 0 ? <p className="panel-note">{t.empty}</p> : null}
      {list.length > 0 ? (
        <HScroll variant="table" className="admin-table-wrap">
          <table className="admin-table">
            <caption>{t.tableTitle}</caption>
            <thead>
              <tr>
                {(['version', 'date', 'title', 'source', 'state'] as const).map((c) => (
                  <th key={c} scope="col">
                    {t.cols[c]}
                  </th>
                ))}
                <th scope="col">
                  <span className="sr-only">{t.cols.actions}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((n) => (
                <tr key={n.id} className={n.hidden ? 'is-hidden' : undefined}>
                  <td>
                    <b>{n.version}</b>
                  </td>
                  <td>{n.date}</td>
                  <td className="notes-admin-title">{n.title}</td>
                  <td>
                    <span className={`admin-chip note-${n.source}`}>{t.sources[n.source]}</span>
                  </td>
                  <td>
                    {n.hidden ? <span className="admin-chip warn">{t.hidden}</span> : <span className="admin-chip ok">{t.visible}</span>}
                    {n.clash ? <span className="admin-chip bad" title={t.clashHint}>{t.clash}</span> : null}
                  </td>
                  <td className="notes-admin-actions">
                    <button type="button" className="lip pill small" aria-haspopup="dialog" aria-label={t.editOf(n.version)} onClick={() => setEditing(draftOf(n))}>
                      {t.edit}
                    </button>
                    {n.hidden ? (
                      <button type="button" className="lip pill small" aria-label={t.restoreOf(n.version)} disabled={act.isPending} onClick={() => run(n, 'restore')}>
                        {t.restore}
                      </button>
                    ) : (
                      <button type="button" className="lip pill small" aria-label={t.hideOf(n.version)} disabled={act.isPending} onClick={() => run(n, 'hide')}>
                        {t.hide}
                      </button>
                    )}
                    {n.source === 'panel' ? (
                      <button type="button" className="lip pill small" aria-haspopup="dialog" aria-label={t.deleteOf(n.version)} onClick={() => setDeleting(n)}>
                        {t.delete}
                      </button>
                    ) : n.source === 'edited' ? (
                      <button type="button" className="lip pill small" aria-label={t.backToGameOf(n.version)} disabled={act.isPending} onClick={() => run(n, 'revert')}>
                        {t.backToGame}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </HScroll>
      ) : null}
      {editing ? <Editor draft={editing} taken={new Set(list.map((n) => n.id))} onClose={() => setEditing(null)} /> : null}
      {deleting ? (
        <Dialog title={t.deleteOf(deleting.version)} role="alertdialog" onClose={() => setDeleting(null)}>
          <p>{t.deleteBody(deleting.title)}</p>
          <div className="modal-actions">
            <button type="button" className="lip pill" data-autofocus onClick={() => setDeleting(null)}>
              {t.cancel}
            </button>
            <button
              type="button"
              className="lip pill pill-solar"
              onClick={() => {
                run(deleting, 'delete');
                setDeleting(null);
              }}
            >
              {t.delete}
            </button>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}
