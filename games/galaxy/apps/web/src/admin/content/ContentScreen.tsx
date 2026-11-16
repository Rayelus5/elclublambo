import { configIssues, configJsonSchema, type DraftConflict, type DraftView, mergeDraft } from '@galaxy/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { DRAFTS_KEY, saveDraftField, useCreateDraft, useDiscardDraft, useDraft, useDrafts, usePublishDraft, useRebaseDraft } from '../../api/config-drafts';
import { type ConfigKeyRow, useConfigKey, useConfigVersions, useFetchConfigVersion } from '../../api/config';
import { errorText } from '../../auth/useMe';
import { copy } from '../../copy/es';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { cellText } from '../DataTable';
import { humanDiff } from '../forms/humanDiff';
import { issueText } from '../forms/issues';
import { KEY_INFO } from '../forms/labels';
import { PublishFields } from '../PublishFields';
import { changedFields } from './drafts';

// The run content's page (the content editor, 2026-11-16, P2): changes go through server-side drafts. The list of open
// drafts, a new one, the published versions (any can come back as a new draft); an open draft (?borrador=<id>) is
// edited — saved field by field as it changes —, merged with what was published since, tried in a test run, published
// or discarded. The visual editor (P4) replaces the JSON here; the draft flow stays.

const t = copy.admin.drafts;
const SAVE_DELAY_MS = 600;
type Side = 'mine' | 'live';

export function ContentScreen() {
  const [params, setParams] = useSearchParams();
  const id = params.get('borrador');
  const live = useConfigKey('content');
  const [notice, setNotice] = useState<string | null>(null);
  const open = (draft: string | null) => setParams(draft ? { borrador: draft } : {});
  return (
    <section className="admin-page content-page">
      <Link to="/admin/configuracion" className="lip pill small">
        <Icon name="back" />
        <span>{copy.admin.config.back}</span>
      </Link>
      <h1>{KEY_INFO.content.title}</h1>
      {live.error ? <p className="field-error">{errorText(live.error, copy.errors)}</p> : null}
      {notice ? (
        <p className="admin-done" role="status">
          {notice}
        </p>
      ) : null}
      {live.data ? (
        id ? (
          <DraftEditor
            key={id}
            id={id}
            live={live.data}
            onClose={(message) => {
              setNotice(message ?? null);
              open(null);
            }}
          />
        ) : (
          <DraftHome live={live.data} onOpen={(d) => {
            setNotice(null);
            open(d);
          }} />
        )
      ) : null}
    </section>
  );
}

/** The open drafts, a new one, and the published versions (any can come back as a draft). */
function DraftHome({ live, onOpen }: { live: ConfigKeyRow; onOpen: (id: string) => void }) {
  const ids = useId();
  const drafts = useDrafts();
  const create = useCreateDraft();
  const versions = useConfigVersions('content');
  const fetchVersion = useFetchConfigVersion();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function fromVersion(version: number) {
    setBusy(true);
    setError(null);
    try {
      const old = await fetchVersion('content', version);
      const draft = await create.mutateAsync(t.fromVersionTitle(version));
      let revision = draft.revision;
      for (const [field, value] of Object.entries(changedFields(live.data, old.data as Record<string, unknown>, {}))) {
        if (value === null) continue;
        revision = (await saveDraftField(draft.id, { key: 'content', field, value, revision })).revision;
      }
      onOpen(draft.id);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="lip panel content-drafts" aria-labelledby={`${ids}-t`}>
        <h2 id={`${ids}-t`}>{t.title}</h2>
        <p className="panel-note">{t.intro}</p>
        {drafts.data && drafts.data.length === 0 ? <p className="panel-note">{t.none}</p> : null}
        <ul className="content-draft-list" aria-label={t.list}>
          {(drafts.data ?? []).map((d) => (
            <li key={d.id}>
              <div>
                <b>{d.title}</b>
                <span className="panel-note">{t.changes(d.fields.length)}</span>
                <span className="panel-note">{t.by(d.updatedBy ?? d.createdBy ?? '', cellText('at', d.updatedAt))}</span>
                {d.stale ? <span className="admin-chip warn">{t.stale}</span> : null}
              </div>
              <button type="button" className="lip pill small" aria-label={t.open(d.title)} onClick={() => onOpen(d.id)}>
                {t.openShort}
              </button>
            </li>
          ))}
        </ul>
        <form
          className="content-draft-new"
          onSubmit={(e) => {
            e.preventDefault();
            const name = title.trim();
            if (!name) return;
            create.mutate(name, { onSuccess: (d) => onOpen(d.id) });
          }}
        >
          <div className="field">
            <label htmlFor={`${ids}-n`}>{t.newTitle}</label>
            <div className="control">
              <input id={`${ids}-n`} type="text" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
          </div>
          <button type="submit" className="lip pill" disabled={!title.trim() || create.isPending}>
            {t.create}
          </button>
        </form>
        {create.error || error ? <p className="field-error">{errorText(create.error ?? error, copy.errors)}</p> : null}
      </section>
      <section className="lip panel admin-history" aria-label={t.history}>
        <h2>{t.history}</h2>
        {versions.data && versions.data.length === 0 ? <p className="panel-note">{t.noHistory}</p> : null}
        <ul>
          {[...(versions.data ?? [])].reverse().map((v) => (
            <li key={v.version}>
              <b>{t.version(v.version)}</b>
              <span>{v.author ? t.by(v.author, cellText('at', v.createdAt)) : cellText('at', v.createdAt)}</span>
              <span className="panel-note">{v.note}</span>
              <button type="button" className="lip pill small" disabled={busy} onClick={() => void fromVersion(v.version)}>
                {t.fromVersion(v.version)}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/** An open draft, once it has loaded. */
function DraftEditor({ id, live, onClose }: { id: string; live: ConfigKeyRow; onClose: (message?: string) => void }) {
  const draft = useDraft(id);
  if (!draft.data) return draft.error ? <p className="field-error">{errorText(draft.error, copy.errors)}</p> : null;
  return <DraftBody id={id} first={draft.data} live={live} onClose={onClose} />;
}

/** An open draft: the content as JSON, saved as it changes; its checks, its changes, rebasing, trying, publishing. */
function DraftBody({ id, first, live, onClose }: { id: string; first: DraftView; live: ConfigKeyRow; onClose: (message?: string) => void }) {
  const ids = useId();
  const qc = useQueryClient();
  const draft = useDraft(id);
  const rebase = useRebaseDraft(id);
  const publish = usePublishDraft(id);
  const discard = useDiscardDraft(id);
  const schema = configJsonSchema('content');
  // The text starts from the draft over what is live.
  const [text, setText] = useState<string | null>(() => JSON.stringify(mergeDraft('content', live.data, first.data.content ?? {}), null, 2));
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<unknown>(null);
  const [conflicts, setConflicts] = useState<DraftConflict[] | null>(null);
  const [asking, setAsking] = useState(false);
  const view = useRef<DraftView | null>(first);
  const queue = useRef(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const parsed = useMemo(() => {
    if (text === null) return null;
    try {
      const v = JSON.parse(text) as unknown;
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }, [text]);
  const issues = parsed ? configIssues('content', parsed) : [];
  const changes = parsed ? humanDiff('content', schema, live.data, parsed) : [];

  function save(next: Record<string, unknown>) {
    queue.current = queue.current.then(async () => {
      const current = view.current;
      if (!current) return;
      const changed = changedFields(live.data, next, current.data.content ?? {});
      if (Object.keys(changed).length === 0) return;
      setStatus('saving');
      try {
        let latest = current;
        for (const [field, value] of Object.entries(changed)) latest = await saveDraftField(id, { key: 'content', field, value, revision: latest.revision });
        view.current = latest;
        qc.setQueryData([...DRAFTS_KEY, id], latest);
        setStatus('saved');
      } catch (err) {
        setSaveError(err);
        setStatus('error');
        await qc.invalidateQueries({ queryKey: [...DRAFTS_KEY, id] });
      }
    });
  }

  function edit(value: string) {
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    let next: unknown;
    try {
      next = JSON.parse(value);
    } catch {
      return;
    }
    if (!next || typeof next !== 'object' || Array.isArray(next)) return;
    timer.current = setTimeout(() => save(next as Record<string, unknown>), SAVE_DELAY_MS);
  }

  function runRebase(resolutions: Parameters<typeof rebase.mutate>[0] = {}) {
    rebase.mutate(resolutions, {
      onSuccess: (r) => {
        if (r.conflicts.length > 0) {
          setConflicts(r.conflicts);
          return;
        }
        setConflicts(null);
        view.current = r.draft;
        setText(JSON.stringify(mergeDraft('content', live.data, r.draft.data.content ?? {}), null, 2));
      },
    });
  }

  const d = draft.data ?? first;
  return (
    <div className="cf-layout content-editor">
      <div className="cf-main">
        <div className="content-editor-head">
          <button type="button" className="lip pill small" onClick={() => onClose()}>
            <Icon name="back" />
            <span>{t.back}</span>
          </button>
          <h2>{d.title}</h2>
          <span className="panel-note" role="status">
            {status === 'saving' ? t.saving : status === 'saved' ? t.saved : ''}
          </span>
        </div>
        {status === 'error' ? <p className="field-error">{errorText(saveError, copy.errors)}</p> : null}
        {d.stale ? (
          <div className="admin-warn" role="note">
            <p>{t.staleNote}</p>
            <button type="button" className="lip pill small" disabled={rebase.isPending} onClick={() => runRebase()}>
              {t.rebase}
            </button>
          </div>
        ) : null}
        <div className="field">
          <label htmlFor={`${ids}-j`}>{t.json}</label>
          <p className="hint">{t.jsonHint}</p>
          <textarea id={`${ids}-j`} className="admin-json content-json" spellCheck={false} rows={28} value={text ?? ''} aria-invalid={text !== null && !parsed} onChange={(e) => edit(e.target.value)} />
          {text !== null && !parsed ? <p className="field-error">{t.invalidJson}</p> : null}
        </div>
      </div>
      <aside className="cf-aside">
        <section className="lip panel" aria-label={t.issues}>
          <h3>{t.issues}</h3>
          {issues.length === 0 ? (
            <p className="panel-note">{t.noIssues}</p>
          ) : (
            <ul className="admin-issues">
              {issues.map((i) => (
                <li key={`${i.path}:${i.message}`}>
                  <code>{i.path || 'contenido'}</code> {issueText(i.message)}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="lip panel" aria-label={t.changesTitle}>
          <h3>{t.changesTitle}</h3>
          {changes.length === 0 ? (
            <p className="panel-note">{t.noChanges}</p>
          ) : (
            <ul>
              {changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
        </section>
        <section className="lip panel content-try">
          <Link className="lip pill" to={`/incursion?borrador=${id}`}>
            {t.tryInRun}
          </Link>
          <p className="panel-note">{t.tryInRunHint}</p>
        </section>
        <PublishFields
          busy={publish.isPending}
          disabled={issues.length > 0 || d.fields.length === 0}
          error={publish.error}
          label={t.publish}
          onPublish={(reason, password) =>
            publish.mutate({ reason, password }, { onSuccess: (r) => onClose(r.versions.content ? t.published(r.versions.content) : undefined) })
          }
        />
        <button type="button" className="lip pill small danger" onClick={() => setAsking(true)}>
          {t.discard}
        </button>
      </aside>
      {conflicts ? <RebaseDialog conflicts={conflicts} busy={rebase.isPending} onCancel={() => setConflicts(null)} onApply={runRebase} /> : null}
      {asking ? (
        <Dialog title={t.discardTitle} role="alertdialog" onClose={() => setAsking(false)}>
          <p>{t.discardBody}</p>
          <div className="dialog-actions">
            <button type="button" className="lip pill" onClick={() => setAsking(false)}>
              {t.cancel}
            </button>
            <button type="button" className="lip pill danger" disabled={discard.isPending} onClick={() => discard.mutate(undefined, { onSuccess: () => onClose() })}>
              {t.discardConfirm}
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

/** What both sides changed: for each, whose side stays. */
function RebaseDialog({
  conflicts,
  busy,
  onCancel,
  onApply,
}: {
  conflicts: DraftConflict[];
  busy: boolean;
  onCancel: () => void;
  onApply: (resolutions: Partial<Record<DraftConflict['key'], Record<string, Record<string, Side>>>>) => void;
}) {
  const ids = useId();
  const [picked, setPicked] = useState<Record<number, Side>>({});
  const all = conflicts.every((_, k) => picked[k]);
  return (
    <Dialog title={t.conflictsTitle} onClose={onCancel}>
      <p>{t.conflictsHint}</p>
      <ul className="content-conflicts">
        {conflicts.map((c, k) => (
          <li key={`${c.key}:${c.field}:${c.id ?? ''}`}>
            <b>{t.conflictWhere(c.field, c.id)}</b>
            <div role="radiogroup" aria-label={t.conflictWhere(c.field, c.id)}>
              {(['mine', 'live'] as const).map((side) => (
                <label key={side}>
                  <input type="radio" name={`${ids}-${k}`} checked={picked[k] === side} onChange={() => setPicked((p) => ({ ...p, [k]: side }))} />
                  {side === 'mine' ? t.keepMine : t.keepLive}
                </label>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <div className="dialog-actions">
        <button type="button" className="lip pill" onClick={onCancel}>
          {t.cancel}
        </button>
        <button
          type="button"
          className="lip pill"
          disabled={!all || busy}
          onClick={() => {
            const out: Partial<Record<DraftConflict['key'], Record<string, Record<string, Side>>>> = {};
            conflicts.forEach((c, k) => {
              const byField = (out[c.key] ??= {});
              (byField[c.field] ??= {})[c.id ?? '*'] = picked[k]!;
            });
            onApply(out);
          }}
        >
          {t.applyRebase}
        </button>
      </div>
    </Dialog>
  );
}
