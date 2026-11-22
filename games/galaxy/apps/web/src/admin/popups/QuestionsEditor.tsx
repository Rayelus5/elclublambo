import { POPUP_MAX_QUESTIONS, POPUP_SCALE_RANGES, type PopupIssue, type PopupKind, type PopupQuestion } from '@galaxy/shared';
import type { Content } from '@galaxy/sim';
import { useId } from 'react';
import { Icon } from '../../ui/Icon';
import { Segmented } from '../../ui/Segmented';
import { Switch } from '../../ui/Switch';
import { hasIssue, NumberRow, Problems, TextRow, ToggleRow } from './fields';
import { freeId, freshQuestion, t } from './shared';
import { SubjectPicker } from './SubjectPicker';

// The questions of a campaign (plan 2026-11-22, part A): a survey's one scale and a review's stars (with an optional text
// under them) keep their shape; a form's questions are cards that change type, move up and down and go, up to the
// most a campaign holds. Each type its own fields: a scale's range, end words and subject (with its drawing), a choice's
// options (2 to 8) and whether several go, a text's helper words, whether it must be written and how long it can be.

type Q<T extends PopupQuestion['type']> = Extract<PopupQuestion, { type: T }>;
const OPTIONS = { min: 2, max: 8 };
const LENGTH = { min: 50, max: 1000 };
const TYPES: readonly PopupQuestion['type'][] = ['scale', 'stars', 'choice', 'text'];

export interface QuestionsEditorProps {
  kind: Exclude<PopupKind, 'promotion'>;
  questions: readonly PopupQuestion[];
  issues: readonly PopupIssue[];
  content: Content;
  onChange: (questions: PopupQuestion[]) => void;
}

export function QuestionsEditor({ kind, questions, issues, content, onChange }: QuestionsEditorProps) {
  const setAt = (i: number, q: PopupQuestion) => onChange(questions.map((x, k) => (k === i ? q : x)));
  if (kind === 'survey') {
    const q = questions[0];
    return q?.type === 'scale' ? (
      <div className="lip panel apop-question">
        <QuestionBody q={q} path="questions.0" issues={issues} content={content} onChange={(x) => setAt(0, x)} />
      </div>
    ) : null;
  }
  if (kind === 'review') {
    const stars = questions[0];
    const text = questions[1]?.type === 'text' ? questions[1] : null;
    return (
      <>
        <div className="lip panel apop-question">
          {stars ? <QuestionBody q={stars} path="questions.0" issues={issues} content={content} onChange={(x) => setAt(0, x)} /> : null}
        </div>
        <ToggleRow
          label={t.q.withText}
          hint={t.q.withTextHint}
          checked={!!text}
          onChange={(on) => onChange(on ? [questions[0]!, freshQuestion('text', freeId('q', questions.map((x) => x.id)), t.templates.game.text)] : [questions[0]!])}
        >
          {text ? <QuestionBody q={text} path="questions.1" issues={issues} content={content} onChange={(x) => setAt(1, x)} /> : null}
        </ToggleRow>
      </>
    );
  }
  const move = (i: number, by: -1 | 1) => {
    const next = [...questions];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    onChange(next);
  };
  return (
    <>
      <ol className="apop-questions">
        {questions.map((q, i) => (
          <li key={q.id} className={`lip panel apop-question${hasIssue(issues, `questions.${i}`) ? ' bad' : ''}`}>
            <div className="apop-question-head">
              <b className="apop-question-n">{t.q.n(i + 1)}</b>
              <TypePicker value={q.type} onChange={(type) => type !== q.type && setAt(i, freshQuestion(type, q.id, q.prompt))} />
              <span className="apop-question-tools">
                <button type="button" className="cf-icon-btn" aria-label={t.q.up(i + 1)} disabled={i === 0} onClick={() => move(i, -1)}>
                  <Icon name="up" />
                </button>
                <button type="button" className="cf-icon-btn" aria-label={t.q.down(i + 1)} disabled={i === questions.length - 1} onClick={() => move(i, 1)}>
                  <Icon name="down" />
                </button>
                <button type="button" className="cf-icon-btn danger" aria-label={t.q.remove(i + 1)} disabled={questions.length <= 1} onClick={() => onChange(questions.filter((_, k) => k !== i))}>
                  <Icon name="trash" />
                </button>
              </span>
            </div>
            <QuestionBody q={q} path={`questions.${i}`} issues={issues} content={content} onChange={(x) => setAt(i, x)} />
          </li>
        ))}
      </ol>
      <Problems issues={issues} path="questions" exact />
      <div className="apop-add-row">
        <button type="button" className="lip pill small" disabled={questions.length >= POPUP_MAX_QUESTIONS} onClick={() => onChange([...questions, freshQuestion('choice', freeId('q', questions.map((x) => x.id)))])}>
          <Icon name="plus" />
          <span>{t.q.add}</span>
        </button>
        {questions.length >= POPUP_MAX_QUESTIONS ? <span className="cf-hint">{t.q.full(POPUP_MAX_QUESTIONS)}</span> : null}
      </div>
    </>
  );
}

function TypePicker({ value, onChange }: { value: PopupQuestion['type']; onChange: (t: PopupQuestion['type']) => void }) {
  const id = useId();
  return (
    <span className="apop-type">
      <span id={id} className="sr-only">
        {t.q.type}
      </span>
      <Segmented<PopupQuestion['type']> aria-labelledby={id} value={value} options={TYPES.map((x) => ({ value: x, label: t.q.types[x] }))} onChange={onChange} />
    </span>
  );
}

/** One question's fields, by its type. */
function QuestionBody({ q, path, issues, content, onChange }: { q: PopupQuestion; path: string; issues: readonly PopupIssue[]; content: Content; onChange: (q: PopupQuestion) => void }) {
  const prompt = <TextRow label={t.q.prompt} value={q.prompt} max={120} wide issues={issues} path={`${path}.prompt`} onChange={(prompt) => onChange({ ...q, prompt })} />;
  switch (q.type) {
    case 'scale':
      return (
        <div className="cf-grid apop-q-grid">
          {prompt}
          <ScaleFields q={q} path={path} issues={issues} content={content} onChange={onChange} />
        </div>
      );
    case 'stars':
      return <div className="cf-grid apop-q-grid">{prompt}</div>;
    case 'choice':
      return (
        <div className="cf-grid apop-q-grid">
          {prompt}
          <ChoiceFields q={q} path={path} issues={issues} onChange={onChange} />
        </div>
      );
    case 'text':
      return (
        <div className="cf-grid apop-q-grid">
          {prompt}
          <TextRow label={t.q.placeholder} value={q.placeholder} max={60} issues={issues} path={`${path}.placeholder`} onChange={(placeholder) => onChange({ ...q, placeholder })} />
          <NumberRow
            label={t.q.maxLength}
            value={q.maxLength}
            hint={t.q.maxLengthHint(LENGTH.min, LENGTH.max)}
            invalid={hasIssue(issues, `${path}.maxLength`)}
            onChange={(maxLength) => onChange({ ...q, maxLength })}
          />
          <SwitchField label={t.q.required} hint={t.q.requiredHint} checked={q.required} onChange={(required) => onChange({ ...q, required })} />
          <div className="apop-wide">
            <Problems issues={issues} path={`${path}.maxLength`} />
          </div>
        </div>
      );
  }
}

function ScaleFields({ q, path, issues, content, onChange }: { q: Q<'scale'>; path: string; issues: readonly PopupIssue[]; content: Content; onChange: (q: PopupQuestion) => void }) {
  const id = useId();
  return (
    <>
      <div className="cf-field apop-wide">
        <span id={`${id}-r`} className="cf-absent-label">
          {t.q.range}
        </span>
        <Segmented<Q<'scale'>['range']> aria-labelledby={`${id}-r`} aria-describedby={`${id}-rh`} value={q.range} options={POPUP_SCALE_RANGES.map((r) => ({ value: r, label: t.q.ranges[r] }))} onChange={(range) => onChange({ ...q, range })} />
        <small id={`${id}-rh`} className="cf-hint">
          {t.q.rangeHint}
        </small>
      </div>
      <TextRow label={t.q.low} value={q.low} max={30} issues={issues} path={`${path}.low`} onChange={(low) => onChange({ ...q, low })} />
      <TextRow label={t.q.high} value={q.high} max={30} issues={issues} path={`${path}.high`} onChange={(high) => onChange({ ...q, high })} />
      <p className="cf-hint apop-wide apop-ends-hint">{t.q.endsHint}</p>
      <div className="apop-wide">
        <SubjectPicker value={q.subject} content={content} invalid={hasIssue(issues, `${path}.subject`)} onChange={(subject) => onChange({ ...q, subject })} />
        <Problems issues={issues} path={`${path}.subject`} />
      </div>
    </>
  );
}

function ChoiceFields({ q, path, issues, onChange }: { q: Q<'choice'>; path: string; issues: readonly PopupIssue[]; onChange: (q: PopupQuestion) => void }) {
  const ids = useId();
  const setOption = (i: number, label: string) => onChange({ ...q, options: q.options.map((o, k) => (k === i ? { ...o, label } : o)) });
  return (
    <>
      <SwitchField label={t.q.multi} hint={t.q.multiHint} checked={q.multi} onChange={(multi) => onChange({ ...q, multi })} />
      <fieldset className="apop-options apop-wide" aria-describedby={`${ids}-h`}>
        <legend className="cf-absent-label">{t.q.options}</legend>
        <ol>
          {q.options.map((o, i) => (
            <li key={o.id}>
              <span className={`apop-option-mark${q.multi ? '' : ' round'}`} aria-hidden="true" />
              <label className="sr-only" htmlFor={`${ids}-${o.id}`}>
                {t.q.option(i + 1)}
              </label>
              <input
                id={`${ids}-${o.id}`}
                type="text"
                autoComplete="off"
                maxLength={60}
                value={o.label}
                placeholder={t.q.option(i + 1)}
                aria-invalid={hasIssue(issues, `${path}.options.${i}`) || undefined}
                onChange={(e) => setOption(i, e.target.value)}
              />
              <button type="button" className="cf-icon-btn danger" aria-label={t.q.removeOption(i + 1)} disabled={q.options.length <= OPTIONS.min} onClick={() => onChange({ ...q, options: q.options.filter((_, k) => k !== i) })}>
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ol>
        <div className="apop-add-row">
          <button
            type="button"
            className="lip pill small"
            disabled={q.options.length >= OPTIONS.max}
            onClick={() => onChange({ ...q, options: [...q.options, { id: freeId('o', q.options.map((o) => o.id)), label: '' }] })}
          >
            <Icon name="plus" />
            <span>{t.q.addOption}</span>
          </button>
          <span id={`${ids}-h`} className="cf-hint">
            {t.q.optionsHint(OPTIONS.min, OPTIONS.max)}
          </span>
        </div>
        <Problems issues={issues} path={`${path}.options`} />
      </fieldset>
    </>
  );
}

/** A switch as a field of the grid: its name, the switch and what it does. */
function SwitchField({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (on: boolean) => void }) {
  const id = useId();
  return (
    <div className="cf-field apop-switch-field">
      <span id={`${id}-l`} className="cf-absent-label">
        {label}
      </span>
      <Switch aria-labelledby={`${id}-l`} aria-describedby={`${id}-h`} checked={checked} onChange={onChange} />
      <small id={`${id}-h`} className="cf-hint">
        {hint}
      </small>
    </div>
  );
}
