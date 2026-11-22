import { NEWS_ROUTES, type NewsLink, type NewsRoute } from '@galaxy/shared';
import { useId, useState } from 'react';
import { copy } from '../copy/es';
import { Segmented } from '../ui/Segmented';
import { Select } from '../ui/Select';

// Where a card or a popup leads (the owner's «Tablón», 2026-11-14; shared since «Encuestas y avisos»): nowhere, a
// screen of the game from a closed list, or an https page, with the button's words: the shape of `newsLinkSchema`.
// Only the panel's own widgets (the owner: never the system's radios or selects): the kinds in a segmented control and
// the screens in the game's dropdown. What was written is remembered while switching kinds, so going to «Sin enlace»
// and back loses nothing.

const t = copy.admin.news;
type Kind = 'none' | NewsLink['kind'];
const KINDS: readonly Kind[] = ['none', 'route', 'url'];

/** The screen, address and words written last, for the kinds not chosen now. */
interface Memory {
  route: NewsRoute;
  href: string;
  label: string;
}

const remember = (m: Memory, link: NewsLink | null): Memory =>
  !link ? m : link.kind === 'route' ? { ...m, route: link.to, label: link.label } : { ...m, href: link.href, label: link.label };

export interface LinkFieldProps {
  /** The group's name (the board's «Al pulsarla», a popup's «Ver más»). */
  legend: string;
  /** The link as typed (its words and address untrimmed: trim them when saving), or null for none. */
  value: NewsLink | null;
  onChange: (link: NewsLink | null) => void;
}

/** A «Ver más» link editor: no link, a screen of the game or an https page, and the button's words. */
export function LinkField({ legend, value, onChange }: LinkFieldProps) {
  const ids = useId();
  const [memory, setMemory] = useState<Memory>(() => remember({ route: NEWS_ROUTES[0], href: '', label: '' }, value));
  const choose = (kind: Kind) => {
    // What is written now goes to the memory before switching.
    const m = remember(memory, value);
    setMemory(m);
    onChange(kind === 'route' ? { kind: 'route', to: m.route, label: m.label } : kind === 'url' ? { kind: 'url', href: m.href, label: m.label } : null);
  };
  const text = (k: 'url' | 'label', max: number, current: string, set: (v: string) => void, hint: string) => (
    <div className="field">
      <label htmlFor={`${ids}-${k}`}>{t.fields[k]}</label>
      <div className="control">
        <input
          id={`${ids}-${k}`}
          type={k === 'url' ? 'url' : 'text'}
          inputMode={k === 'url' ? 'url' : undefined}
          autoComplete="off"
          maxLength={max}
          value={current}
          placeholder={k === 'url' ? 'https://' : undefined}
          aria-describedby={`${ids}-${k}-hint`}
          onChange={(e) => set(e.target.value)}
        />
      </div>
      <p className="hint" id={`${ids}-${k}-hint`}>
        {hint}
      </p>
    </div>
  );
  return (
    <fieldset className="admin-link">
      <legend id={`${ids}-legend`}>{legend}</legend>
      <Segmented<Kind> aria-labelledby={`${ids}-legend`} value={value?.kind ?? 'none'} options={KINDS.map((k) => ({ value: k, label: t.linkKinds[k] }))} onChange={choose} />
      {value?.kind === 'route' ? (
        <div className="field">
          <label id={`${ids}-route-label`} htmlFor={`${ids}-route`}>
            {t.fields.route}
          </label>
          <div className="control">
            <Select<NewsRoute> id={`${ids}-route`} aria-labelledby={`${ids}-route-label`} block value={value.to} options={NEWS_ROUTES.map((r) => ({ value: r, label: t.routes[r] }))} onChange={(to) => onChange({ ...value, to })} />
          </div>
        </div>
      ) : null}
      {value?.kind === 'url' ? text('url', 300, value.href, (href) => onChange({ ...value, href }), t.urlHint) : null}
      {value ? text('label', 32, value.label, (label) => onChange({ ...value, label }), t.labelHint) : null}
    </fieldset>
  );
}
