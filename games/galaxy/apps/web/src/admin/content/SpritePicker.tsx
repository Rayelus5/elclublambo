import { ART, ART_FIELDS, type ArtGroup } from '@galaxy/shared';
import { useEffect, useId, useMemo, useState } from 'react';
import { copy } from '../../copy/es';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import type { WidgetProps } from '../forms/ConfigForm';
import { artUrl } from './art';

// The content's drawings picked from a gallery (the content editor, 2026-11-16, P5): an enemy, a Core, a probe or an
// icon never names a drawing by hand. The gallery opens on the field's own group (ART_FIELDS) and can show them all;
// only drawings the arena has are offered, so a run never meets an unknown one.

const t = copy.admin.content;
const GROUPS: ArtGroup[] = ['fauna', 'nucleos', 'sondas', 'iconos', 'otros'];
const fold = (s: string) => s.toLowerCase();

/** The chosen drawing, moving through its frames (still with reduced motion). */
function Preview({ id }: { id: string }) {
  const frames = ART[id]?.frames ?? 1;
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (frames < 2 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => setFrame((f) => (f + 1) % frames), 220);
    return () => clearInterval(timer);
  }, [frames]);
  const url = artUrl(id, 3, frame % frames);
  return url ? <img className="ce-art-preview" src={url} alt="" width={72} height={72} /> : <span className="ce-art-preview ce-art-missing" aria-hidden="true" />;
}

export function SpritePicker({ value, pattern, info, set, problems }: WidgetProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const current = typeof value === 'string' ? value : '';
  const art = Object.hasOwn(ART, current) ? ART[current] : undefined;
  const group: ArtGroup = ART_FIELDS[pattern as keyof typeof ART_FIELDS] ?? 'otros';
  return (
    <div className="cf-field ce-art">
      <span id={`${id}-l`} className="cf-absent-label">
        {info.label}
      </span>
      <div className="ce-art-current" aria-labelledby={`${id}-l`} role="group">
        <Preview id={current} />
        <div className="ce-art-meta">
          <code>{current || '—'}</code>
          <small>{art ? t.artSize(art.w, art.h, art.frames) : t.artMissing}</small>
        </div>
        <button type="button" className="lip pill small" onClick={() => setOpen(true)}>
          <Icon name="cards" />
          <span>{t.changeArt}</span>
        </button>
      </div>
      {info.hint ? <small className="cf-hint">{info.hint}</small> : null}
      {problems?.length ? (
        <ul className="cf-problems" role="alert">
          {problems.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
      {open ? (
        <ArtGallery
          start={group}
          value={current}
          onClose={() => setOpen(false)}
          onPick={(next) => {
            set(next);
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function ArtGallery({ start, value, onPick, onClose }: { start: ArtGroup; value: string; onPick: (id: string) => void; onClose: () => void }) {
  const [group, setGroup] = useState<ArtGroup | 'all'>(start);
  const [query, setQuery] = useState('');
  const shown = useMemo(
    () => Object.entries(ART).filter(([id, a]) => (group === 'all' || a.group === group) && (!query.trim() || fold(id).includes(fold(query.trim())))),
    [group, query],
  );
  return (
    <Dialog title={t.gallery} onClose={onClose} className="ce-gallery">
      <div className="ce-gallery-tools">
        <div className="tabs admin-tabs" role="tablist" aria-label={t.galleryGroups}>
          {[...GROUPS, 'all' as const].map((g) => (
            <button key={g} type="button" role="tab" aria-selected={g === group} onClick={() => setGroup(g)}>
              {t.groups[g]}
            </button>
          ))}
        </div>
        <input type="search" className="ce-search" aria-label={t.searchArt} placeholder={t.searchArt} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="ce-gallery-grid">
        {shown.map(([id, a]) => {
          const url = artUrl(id, a.w > 32 ? 1 : 2);
          return (
            <button key={id} type="button" className="ce-gallery-item" aria-label={id} aria-pressed={id === value} onClick={() => onPick(id)}>
              {url ? <img src={url} alt="" /> : <span className="ce-art-missing" aria-hidden="true" />}
              <small>{id}</small>
            </button>
          );
        })}
      </div>
      {shown.length === 0 ? <p className="panel-note">{t.noMatches}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="lip pill" onClick={onClose}>
          {t.keepArt}
        </button>
      </div>
    </Dialog>
  );
}
