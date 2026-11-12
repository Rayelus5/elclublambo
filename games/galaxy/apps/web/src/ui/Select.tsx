import { type KeyboardEvent, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { useFollowAnchor, useOutsidePress } from './popup';

// The game's own dropdown (C1 of the November plan, the owner: «todos los selectores/desplegables en la web deberían
// ser con diseño custom y nunca con diseño por defecto del ordenador»; DESIGN_SYSTEM §7). A select-only combobox after
// the WAI-ARIA APG pattern: the trigger keeps the focus and points at the active option with aria-activedescendant;
// the list lives in a portal on <body> placed from the trigger (ui/popup.ts), so no scrolling panel or dialog clips
// it. It flips above when there is no room below, scrolls inside (without a bar, like everything in the game), follows
// the trigger on scroll and resize and closes when it leaves the screen. Escape closes only the list, never the dialog
// around it.

/** One choice of a {@link Select}. */
export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  /** Shown but not choosable (skipped by the keys and the type-ahead). */
  disabled?: boolean;
}

type DataAttributes = { [key: `data-${string}`]: string | boolean | undefined };

export type SelectProps<V extends string = string> = DataAttributes & {
  value: V;
  options: readonly SelectOption<V>[];
  /** Called only when the value really changes (like a native select). */
  onChange: (value: V) => void;
  /** Lets a `<label htmlFor>` name it. */
  id?: string;
  /** For forms read with FormData: a hidden input carries the value. */
  name?: string;
  disabled?: boolean;
  /** Shown when the value matches no option. */
  placeholder?: string;
  /** `sm` for toolbars, filters and tables (40 px), `md` in the game (44 px), `lg` in forms next to 50 px fields. */
  size?: 'sm' | 'md' | 'lg';
  /** Takes the whole width of its place. */
  block?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
};

/** The list's tallest size (px): beyond it, it scrolls inside. */
const MAX_HEIGHT = 320;
/** How long typed letters keep adding to the search (ms). */
const TYPE_AHEAD = 500;
/** How many options PageUp and PageDown jump. */
const PAGE = 10;

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * A dropdown with the game's look (DESIGN_SYSTEM §7): a trigger with relief showing the chosen option and a chevron,
 * and a list with the chosen one ticked and the active one lit. Keys: closed, Enter, Space and the arrows open it,
 * Home and End open it at the ends, letters search; open, the arrows, Home, End and the pages move, letters search,
 * Enter and Space choose, Tab chooses and moves on, Escape closes. The mouse opens, chooses and closes it by clicking
 * outside.
 */
export function Select<V extends string>({
  value,
  options,
  onChange,
  id,
  name,
  disabled = false,
  placeholder,
  size = 'md',
  block = false,
  className = '',
  'aria-label': ariaLabel,
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  ...data
}: SelectProps<V>) {
  const base = useId();
  const listId = `${base}-list`;
  const optionId = (i: number) => `${base}-o${i}`;
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [opened, setOpened] = useState(false);
  const [active, setActive] = useState(-1);
  /** The list's name, read from the trigger's label when it opens. */
  const [listName, setListName] = useState<string | undefined>(undefined);
  const typed = useRef({ text: '', at: 0 });
  const pointer = useRef({ x: Number.NaN, y: Number.NaN });

  const open = opened && !disabled;
  const selected = options.findIndex((o) => o.value === value);
  const current = options[selected];
  const at = active < options.length ? active : -1;
  const usable = (i: number) => i >= 0 && i < options.length && !options[i]!.disabled;
  const first = () => options.findIndex((o) => !o.disabled);
  const last = () => options.findLastIndex((o) => !o.disabled);
  const start = () => (usable(selected) ? selected : first());

  /** From `from`, `delta` options on (clamped), landing on the nearest enabled one; where none is, it stays. */
  function move(from: number, delta: number): number {
    const dir = delta > 0 ? 1 : -1;
    const target = Math.max(0, Math.min(options.length - 1, from + delta));
    for (let i = target; i >= 0 && i < options.length; i += dir) if (usable(i)) return i;
    for (let i = target - dir; i !== from && i >= 0 && i < options.length; i -= dir) if (usable(i)) return i;
    return usable(from) ? from : first();
  }

  /** Type-ahead: letters typed together find the next option starting that way; one letter repeated cycles. */
  function search(key: string, from: number): number {
    const now = Date.now();
    const t = typed.current;
    t.text = now - t.at > TYPE_AHEAD ? key : t.text + key;
    t.at = now;
    const query = fold(t.text);
    const n = options.length;
    const find = (prefix: string, begin: number) => {
      for (let k = 0; k < n; k++) {
        const i = (((begin + k) % n) + n) % n;
        if (usable(i) && fold(options[i]!.label).startsWith(prefix)) return i;
      }
      return -1;
    };
    // Adding letters keeps the current option while it still matches; a first letter looks past it.
    const found = find(query, query.length > 1 ? Math.max(from, 0) : from + 1);
    if (found >= 0) return found;
    return [...query].every((c) => c === query[0]) ? find(query[0]!, from + 1) : -1;
  }

  const searching = () => typed.current.text !== '' && Date.now() - typed.current.at <= TYPE_AHEAD;

  function show(index: number): void {
    const el = trigger.current;
    setListName(ariaLabel ?? (labelledBy ? undefined : (el?.labels?.[0]?.textContent?.trim() ?? undefined)));
    setActive(index);
    setOpened(true);
    if (el && document.activeElement !== el) el.focus();
  }

  function close(): void {
    setOpened(false);
    typed.current.text = '';
  }

  function choose(index: number): void {
    const option = options[index];
    if (option && !option.disabled && option.value !== value) onChange(option.value);
    close();
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>): void {
    const { key } = e;
    const letter = key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && (key !== ' ' || searching());
    if (!open) {
      if (letter) {
        e.preventDefault();
        const found = search(key, selected);
        show(found >= 0 ? found : start());
      } else if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
        e.preventDefault();
        show(start());
      } else if (key === 'Home' || key === 'End') {
        e.preventDefault();
        show(key === 'Home' ? first() : last());
      }
      return;
    }
    if (letter) {
      e.preventDefault();
      const found = search(key, at);
      if (found >= 0) setActive(found);
      return;
    }
    switch (key) {
      case 'Escape':
        // Only the list closes: the dialog around it stays.
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      case 'Tab':
        choose(at);
        return;
      case 'Enter':
      case ' ':
        e.preventDefault();
        choose(at);
        return;
      case 'ArrowUp':
        e.preventDefault();
        if (e.altKey) choose(at);
        else setActive(move(at, -1));
        return;
      case 'ArrowDown':
        e.preventDefault();
        setActive(move(at, 1));
        return;
      case 'Home':
        e.preventDefault();
        setActive(first());
        return;
      case 'End':
        e.preventDefault();
        setActive(last());
        return;
      case 'PageUp':
        e.preventDefault();
        setActive(move(at, -PAGE));
        return;
      case 'PageDown':
        e.preventDefault();
        setActive(move(at, PAGE));
        return;
    }
  }

  // Placed before the first paint and kept beside the trigger; when the trigger leaves the screen, the list closes.
  useFollowAnchor(open, trigger, list, { maxHeight: MAX_HEIGHT }, close, options.length);

  // The active option stays in view (scrolling only the list, never the page behind it).
  useLayoutEffect(() => {
    const pop = list.current;
    const item = at >= 0 ? (pop?.children[at] as HTMLElement | undefined) : undefined;
    if (!open || !pop || !item) return;
    const pad = parseFloat(getComputedStyle(pop).paddingTop) || 0;
    const top = item.offsetTop - pad;
    const bottom = item.offsetTop + item.offsetHeight + pad;
    if (top < pop.scrollTop) pop.scrollTop = top;
    else if (bottom > pop.scrollTop + pop.clientHeight) pop.scrollTop = bottom - pop.clientHeight;
  }, [open, at]);

  // A press anywhere else closes it without choosing.
  useOutsidePress(open, [trigger, list], close);

  const classes = ['select', `select-${size}`, block ? 'select-block' : '', className].filter(Boolean).join(' ');
  return (
    <>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        id={id}
        className={classes}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && at >= 0 ? optionId(at) : undefined}
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        onClick={() => (open ? close() : show(start()))}
        onKeyDown={onKeyDown}
        // A Space that opened or chose must not click the trigger again on its way up.
        onKeyUp={(e) => e.key === ' ' && e.preventDefault()}
        onBlur={(e) => open && !list.current?.contains(e.relatedTarget as Node | null) && close()}
        {...data}
      >
        <span className={current ? 'select-text' : 'select-text placeholder'}>{current ? current.label : (placeholder ?? '')}</span>
        {/* Every label, invisible, so the trigger is as wide as the longest (as a native select is). */}
        {options.map((o) => (
          <span key={o.value} className="select-sizer" data-label={o.label} aria-hidden="true" />
        ))}
        {placeholder ? <span className="select-sizer" data-label={placeholder} aria-hidden="true" /> : null}
        <Icon name="down" className="ico select-chevron" />
      </button>
      {name !== undefined ? <input type="hidden" name={name} value={value} /> : null}
      {open
        ? createPortal(
            <ul
              ref={list}
              id={listId}
              role="listbox"
              aria-label={labelledBy ? undefined : listName}
              aria-labelledby={labelledBy}
              className="select-pop"
              data-size={size}
              // The focus stays on the trigger.
              onMouseDown={(e) => e.preventDefault()}
            >
              {options.map((o, i) => (
                <li
                  key={o.value}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === selected}
                  aria-disabled={o.disabled || undefined}
                  data-value={o.value}
                  data-active={i === at || undefined}
                  onClick={() => !o.disabled && choose(i)}
                  onMouseMove={(e) => {
                    // A list scrolled by the keys under a resting pointer does not take the active option away.
                    if (o.disabled || (e.clientX === pointer.current.x && e.clientY === pointer.current.y)) return;
                    pointer.current = { x: e.clientX, y: e.clientY };
                    if (i !== at) setActive(i);
                  }}
                >
                  <span className="select-option-label">{o.label}</span>
                  <Icon name="tick" className="ico select-check" />
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
    </>
  );
}
