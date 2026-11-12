import { type KeyboardEvent, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { copy } from '../copy/es';
import { Icon } from './Icon';
import { useFollowAnchor, useOutsidePress } from './popup';

// The admin's dates without the system's calendar (C1 of the November plan, decision 10; DESIGN_SYSTEM §7). A text
// field that takes the date as people write it in Spain (dd/mm/aaaa, with hh:mm when it has a time) or pasted as ISO,
// and a button that opens the game's own calendar, after the WAI-ARIA APG date picker dialog: a month grid starting on
// Monday, the arrows by day and week, Home and End to the week's ends, the pages by month (with Shift, by year), Enter
// to choose, Escape to close (never the dialog around it), Hoy, and the hour and minutes when it has a time. The value
// keeps the format of the native inputs it replaces: «2026-11-12» or «2026-11-12T10:30», and '' when it is empty or
// not a real date.

const t = copy.picker;

/** A calendar day (month 1–12). */
interface Day {
  y: number;
  m: number;
  d: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (x: Day) => `${String(x.y).padStart(4, '0')}-${pad(x.m)}-${pad(x.d)}`;
const dayOf = (date: Date): Day => ({ y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() });
const same = (a: Day, b: Day) => a.y === b.y && a.m === b.m && a.d === b.d;
const daysIn = (y: number, m: number) => new Date(y, m, 0).getDate();
const real = (y: number, m: number, d: number) => y >= 1000 && m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m);
const shiftDays = (x: Day, n: number) => dayOf(new Date(x.y, x.m - 1, x.d + n));
function shiftMonths(x: Day, n: number): Day {
  const first = new Date(x.y, x.m - 1 + n, 1);
  const y = first.getFullYear();
  const m = first.getMonth() + 1;
  return { y, m, d: Math.min(x.d, daysIn(y, m)) };
}
/** Monday is 0. */
const weekday = (x: Day) => (new Date(x.y, x.m - 1, x.d).getDay() + 6) % 7;

const longDay = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const monthYear = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' });
const monthTitle = (x: Day) => {
  const s = monthYear.format(new Date(x.y, x.m - 1, 1));
  return s.charAt(0).toUpperCase() + s.slice(1);
};

interface Parts {
  day: Day;
  h: number;
  min: number;
}

/** The field's value («2026-11-12» or «2026-11-12T10:30») in parts; null when it is empty or not one. */
function parseValue(value: string): Parts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, min] = [m[1], m[2], m[3], m[4] ?? '0', m[5] ?? '0'].map(Number) as [number, number, number, number, number];
  return real(y, mo, d) && h < 24 && min < 60 ? { day: { y, m: mo, d }, h, min } : null;
}

const valueOf = (p: Parts, time: boolean) => (time ? `${keyOf(p.day)}T${pad(p.h)}:${pad(p.min)}` : keyOf(p.day));

/** What the field shows for a value: «12/11/2026», with « 10:30» when it has a time. */
function textOf(value: string, time: boolean): string {
  const p = parseValue(value);
  if (!p) return '';
  const date = `${pad(p.day.d)}/${pad(p.day.m)}/${p.day.y}`;
  return time ? `${date} ${pad(p.h)}:${pad(p.min)}` : date;
}

/**
 * What a typed text means: the value, '' when empty, or null when it is not a real date (a date field takes no time;
 * a date-time field needs it). Spanish order (12/11/2026, 12-11-2026, 12.11.2026) or ISO (2026-11-12).
 */
function parseText(text: string, time: boolean): string | null {
  const s = text.trim();
  if (!s) return '';
  const es = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ ,T]+(\d{1,2}):(\d{2}))?$/.exec(s);
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(s);
  const m = es ?? iso;
  if (!m) return null;
  const [y, mo, d] = (es ? [m[3], m[2], m[1]] : [m[1], m[2], m[3]]).map(Number) as [number, number, number];
  const hasTime = m[4] !== undefined;
  const h = Number(m[4] ?? 0);
  const min = Number(m[5] ?? 0);
  if (!real(y, mo, d) || h > 23 || min > 59 || hasTime !== time) return null;
  return valueOf({ day: { y, m: mo, d }, h, min }, time);
}

/** One part of the time (the hour or the minutes): typed, or moved with the arrows (wrapping round). */
function TimePart({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(pad(value));
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setText(pad(value));
  }
  const set = (n: number) => {
    setSeen(n);
    setText(pad(n));
    onChange(n);
  };
  return (
    <input
      type="text"
      role="spinbutton"
      inputMode="numeric"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      maxLength={2}
      autoComplete="off"
      value={text}
      onChange={(e) => {
        const raw = e.target.value.replace(/\D/g, '');
        setText(raw);
        const n = Number(raw);
        if (raw !== '' && n <= max && n !== value) {
          setSeen(n);
          onChange(n);
        }
      }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        set((value + (e.key === 'ArrowUp' ? 1 : max)) % (max + 1));
      }}
      onBlur={() => setText(pad(value))}
    />
  );
}

export interface DateFieldProps {
  /** The text field's id, for a `<label htmlFor>`. */
  id?: string;
  /** «2026-11-12», or «2026-11-12T10:30» with `time`; '' when empty. */
  value: string;
  onChange: (value: string) => void;
  /** Also the hour and minutes (the value of a native datetime-local input). */
  time?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

/** A date (or date and time) field with the game's own calendar. */
export function DateField({ id, value, onChange, time = false, className = '', 'aria-label': ariaLabel, 'aria-describedby': describedBy, 'aria-invalid': invalid }: DateFieldProps) {
  const base = useId();
  const popId = `${base}-cal`;
  const headId = `${base}-month`;
  const wrap = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  /** The calendar moves the focus to its day after it opens and after the keys move it. */
  const focusDay = useRef(false);
  const [text, setText] = useState(() => textOf(value, time));
  const [seen, setSeen] = useState(value);
  // A value from outside (another version loaded, the calendar) replaces what is typed.
  if (value !== seen) {
    setSeen(value);
    setText(textOf(value, time));
  }
  const [open, setOpen] = useState(false);
  /** The day with the focus in the grid, whose month is shown. */
  const [cursor, setCursor] = useState<Day>(() => dayOf(new Date()));
  const parts = parseValue(value);
  const today = dayOf(new Date());

  /** Sends a new value; `show` writes it in the field too (the calendar, not the keys typing it). */
  function emit(next: string, show: boolean): void {
    setSeen(next);
    if (show) setText(textOf(next, time));
    if (next !== value) onChange(next);
  }

  function show(): void {
    setCursor(parts?.day ?? today);
    focusDay.current = true;
    setOpen(true);
  }

  function hide(restore: boolean): void {
    setOpen(false);
    if (restore) toggle.current?.focus();
  }

  function pick(day: Day): void {
    if (time) {
      emit(valueOf({ day, h: parts?.h ?? 0, min: parts?.min ?? 0 }, true), true);
      setCursor(day);
    } else {
      emit(keyOf(day), true);
      hide(true);
    }
  }

  function setTime(h: number, min: number): void {
    emit(valueOf({ day: parts?.day ?? cursor, h, min }, true), true);
  }

  function onGridKey(e: KeyboardEvent<HTMLButtonElement>): void {
    const moves: Record<string, (x: Day) => Day> = {
      ArrowLeft: (x) => shiftDays(x, -1),
      ArrowRight: (x) => shiftDays(x, 1),
      ArrowUp: (x) => shiftDays(x, -7),
      ArrowDown: (x) => shiftDays(x, 7),
      Home: (x) => shiftDays(x, -weekday(x)),
      End: (x) => shiftDays(x, 6 - weekday(x)),
      PageUp: (x) => shiftMonths(x, e.shiftKey ? -12 : -1),
      PageDown: (x) => shiftMonths(x, e.shiftKey ? 12 : 1),
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    focusDay.current = true;
    setCursor(move(cursor));
  }

  function onPopKey(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') {
      // Only the calendar closes: the dialog around it stays.
      e.preventDefault();
      e.stopPropagation();
      hide(true);
      return;
    }
    if (e.key !== 'Tab' || !pop.current) return;
    // The calendar keeps the focus while it is open (a modal popup).
    e.stopPropagation();
    const items = [...pop.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')].filter((el) => el.tabIndex >= 0);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // Under the field's calendar button, its own width, and seen whole (over its field if it must).
  useFollowAnchor(open, wrap, pop, { maxHeight: 560, matchWidth: false, align: 'end', cover: true }, () => hide(false), `${cursor.y}-${cursor.m}`);
  useOutsidePress(open, [wrap, pop], () => hide(false));

  // The focus goes to the day after opening (once placed) and after each move of the keys.
  useLayoutEffect(() => {
    if (!open || !focusDay.current) return;
    focusDay.current = false;
    pop.current?.querySelector<HTMLElement>(`[data-day="${keyOf(cursor)}"]`)?.focus({ preventScroll: true });
  }, [open, cursor]);

  const first = { y: cursor.y, m: cursor.m, d: 1 };
  const cells: (Day | null)[] = [...Array<null>(weekday(first)).fill(null), ...Array.from({ length: daysIn(cursor.y, cursor.m) }, (_, i) => ({ y: cursor.y, m: cursor.m, d: i + 1 }))];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));

  return (
    <div ref={wrap} className={['datefield', className].filter(Boolean).join(' ')}>
      <input
        id={id}
        type="text"
        className="datefield-input"
        autoComplete="off"
        spellCheck={false}
        placeholder={time ? t.dateTimePlaceholder : t.datePlaceholder}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          emit(parseText(e.target.value, time) ?? '', false);
        }}
        onBlur={() => parts && setText(textOf(value, time))}
      />
      <button
        ref={toggle}
        type="button"
        className="datefield-open"
        aria-label={time ? t.openTime : t.open}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={() => (open ? hide(false) : show())}
      >
        <Icon name="calendar" />
      </button>
      {open
        ? createPortal(
            <div ref={pop} id={popId} role="dialog" aria-modal="true" aria-label={t.title} className="datefield-pop" onKeyDown={onPopKey}>
              <div className="datefield-head">
                <button type="button" className="datefield-nav" aria-label={t.prevMonth} onClick={() => setCursor(shiftMonths(cursor, -1))}>
                  <Icon name="back" />
                </button>
                <h2 id={headId} aria-live="polite">
                  {monthTitle(cursor)}
                </h2>
                <button type="button" className="datefield-nav" aria-label={t.nextMonth} onClick={() => setCursor(shiftMonths(cursor, 1))}>
                  <Icon name="next" />
                </button>
              </div>
              <table role="grid" aria-labelledby={headId} className="datefield-grid">
                <thead>
                  <tr>
                    {t.weekdays.map((w, i) => (
                      <th key={w + i} scope="col" abbr={t.weekdayNames[i]}>
                        {w}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((week, i) => (
                    <tr key={i}>
                      {week.map((day, j) => (
                        <td key={j}>
                          {day ? (
                            <button
                              type="button"
                              className="datefield-day"
                              data-day={keyOf(day)}
                              tabIndex={same(day, cursor) ? 0 : -1}
                              aria-label={longDay.format(new Date(day.y, day.m - 1, day.d))}
                              aria-pressed={!!parts && same(day, parts.day)}
                              aria-current={same(day, today) ? 'date' : undefined}
                              onClick={() => pick(day)}
                              onKeyDown={onGridKey}
                            >
                              {day.d}
                            </button>
                          ) : null}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="datefield-foot">
                {time ? (
                  <div className="datefield-time">
                    <TimePart label={t.hour} value={parts?.h ?? 0} max={23} onChange={(h) => setTime(h, parts?.min ?? 0)} />
                    <span aria-hidden="true">:</span>
                    <TimePart label={t.minute} value={parts?.min ?? 0} max={59} onChange={(min) => setTime(parts?.h ?? 0, min)} />
                  </div>
                ) : null}
                <button type="button" className="lip pill datefield-action" onClick={() => pick(today)}>
                  {t.today}
                </button>
                {time ? (
                  <button type="button" className="lip pill pill-solar datefield-action" onClick={() => hide(true)}>
                    {t.done}
                  </button>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
