import { useId } from 'react';
import { BEAST_TEXT, CORE_TEXT, SECTOR_TEXT } from '../../codex/texts';
import { copy } from '../../copy/es';
import type { WidgetProps } from '../forms/ConfigForm';

// A text tied to an entry (the content editor, 2026-11-16, P8): empty, the game uses its own, shown greyed inside the
// box so the admin knows what players read today; whatever is written replaces it. Emptying it brings the game's back.

const t = copy.admin.content;
type Entry = { id?: string; description?: string };
const hazard = (k: 'meteors' | 'storm' | 'well') => (e: Entry) => copy.arena.events.bySector[e.id ?? '']?.[k] ?? copy.arena.events[k].name;

/** What each text falls back to, by its pattern. */
const FALLBACKS: Record<string, (e: Entry) => string | undefined> = {
  'sectors[].lore': (e) => SECTOR_TEXT[e.id ?? ''] ?? e.description,
  'sectors[].radio': (e) => copy.arena.radio.sectors[e.id ?? ''],
  'sectors[].hazardNames.meteors': hazard('meteors'),
  'sectors[].hazardNames.storm': hazard('storm'),
  'sectors[].hazardNames.well': hazard('well'),
  'bosses[].lore': (e) => CORE_TEXT[e.id ?? ''],
  'bosses[].radio': (e) => copy.arena.radio.bosses[e.id ?? ''] ?? copy.arena.radio.boss,
  'enemies[].lore': (e) => BEAST_TEXT[e.id ?? ''],
};
export const TEXT_PATTERNS = Object.keys(FALLBACKS);

export function TextFallback({ value, node, pattern, root, info, set, problems }: WidgetProps) {
  const id = useId();
  const fallback = FALLBACKS[pattern]?.((root ?? {}) as Entry) ?? '';
  const text = typeof value === 'string' ? value : '';
  const long = (node.maxLength ?? 0) > 120;
  const change = (v: string) => set(v === '' ? undefined : v);
  return (
    <div className={`cf-field ce-text${long ? ' long' : ''}`}>
      <label htmlFor={id}>{info.label}</label>
      {long ? (
        <textarea id={id} rows={3} maxLength={node.maxLength} placeholder={fallback} value={text} aria-invalid={problems?.length ? true : undefined} onChange={(e) => change(e.target.value)} />
      ) : (
        <input id={id} type="text" maxLength={node.maxLength} placeholder={fallback} value={text} aria-invalid={problems?.length ? true : undefined} onChange={(e) => change(e.target.value)} />
      )}
      {info.hint ? <small className="cf-hint">{info.hint}</small> : null}
      {!text ? <small className="cf-hint">{fallback ? t.usesDefault : t.noDefault}</small> : null}
      {problems?.length ? (
        <ul className="cf-problems" role="alert">
          {problems.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
