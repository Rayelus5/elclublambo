import { POPUP_SUBJECT_KINDS, type PopupSubject, type PopupSubjectKind } from '@galaxy/shared';
import type { Content } from '@galaxy/sim';
import { useId, useMemo } from 'react';
import { type SelectOption, Select } from '../../ui/Select';
import { artUrl } from '../content/art';
import { t } from './shared';

// What a scale is about (plan 2026-11-22, part A): none, or an enemy, a Core, a probe or a sector of the live content,
// chosen in two of the game's dropdowns, the second with each one's drawing beside its name (as the content editor's
// lists: a sector shows its Core). The popup draws the same sprite next to the question.

type Choice = 'none' | PopupSubjectKind;

/** The live content's entities of a kind as options with their drawing (none in tests: no canvas). */
export function subjectOptions(kind: PopupSubjectKind, content: Content): SelectOption[] {
  const thumb = (sprite: string | undefined) => (sprite ? (artUrl(sprite, 2) ?? undefined) : undefined);
  switch (kind) {
    case 'enemy':
      return content.enemies.map((e) => ({ value: e.id, label: e.name, image: thumb(e.sprite) }));
    case 'boss':
      return content.bosses.map((b) => ({ value: b.id, label: b.name, image: thumb(b.sprite) }));
    case 'probe':
      return content.probes.map((p) => ({ value: p.id, label: p.name, image: thumb(p.sprite) }));
    case 'sector':
      return content.sectors.map((s) => ({ value: s.id, label: s.name, image: thumb(content.bosses.find((b) => b.id === s.boss)?.sprite) }));
  }
}

export function SubjectPicker({ value, content, onChange, invalid = false }: { value: PopupSubject | null; content: Content; onChange: (s: PopupSubject | null) => void; invalid?: boolean }) {
  const ids = useId();
  const kind: Choice = value?.kind ?? 'none';
  const options = useMemo(() => (value ? subjectOptions(value.kind, content) : []), [value, content]);
  return (
    <div className="apop-subject">
      <div className="cf-field">
        <label id={`${ids}-kl`} htmlFor={`${ids}-k`}>
          {t.q.subject}
        </label>
        <Select<Choice>
          id={`${ids}-k`}
          size="sm"
          block
          aria-labelledby={`${ids}-kl`}
          aria-describedby={`${ids}-h`}
          value={kind}
          options={(['none', ...POPUP_SUBJECT_KINDS] as const).map((k) => ({ value: k, label: t.q.subjectKinds[k] }))}
          onChange={(k) => {
            if (k === 'none') return onChange(null);
            const first = subjectOptions(k, content)[0];
            onChange(first ? { kind: k, id: first.value } : null);
          }}
        />
        <small id={`${ids}-h`} className="cf-hint">
          {t.q.subjectHint}
        </small>
      </div>
      {value ? (
        <div className="cf-field">
          <label id={`${ids}-wl`} htmlFor={`${ids}-w`}>
            {t.q.subjectWhich}
          </label>
          <Select id={`${ids}-w`} size="sm" block aria-labelledby={`${ids}-wl`} aria-invalid={invalid || undefined} value={value.id} options={options} placeholder={value.id} onChange={(id) => onChange({ kind: value.kind, id })} />
        </div>
      ) : null}
    </div>
  );
}
