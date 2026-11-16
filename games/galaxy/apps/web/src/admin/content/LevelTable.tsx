import { WEAPON_FIELDS, type WeaponKind, type WeaponLevel } from '@galaxy/sim';
import { useId } from 'react';
import { copy } from '../../copy/es';
import { Icon } from '../../ui/Icon';
import { NumberInput, type WidgetProps } from '../forms/ConfigForm';
import { getIn, pathKey } from '../forms/schema';
import { describeContent, VOCABS } from './descriptors';

// A weapon's levels as one table (the content editor, 2026-11-16, P6): a row per level, a column per number, each
// column with a small line of how it grows. The numbers its kind does not read are dimmed (WEAPON_FIELDS, proved in the
// sim's tests) and go last, so an admin sees at once which ones matter. An evolution has a single level.

const t = copy.admin.content;
const FIELDS: (keyof WeaponLevel)[] = ['damage', 'cooldown', 'count', 'pierce', 'speed', 'area', 'duration', 'range', 'bounces', 'knockback', 'interval'];
const MAX_LEVELS = 8;

/** How a number goes from the first level to the last. */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const points = values.map((v, i) => `${((i / (values.length - 1)) * 44).toFixed(1)},${(13 - ((v - min) / span) * 11).toFixed(1)}`).join(' ');
  return (
    <svg className="ce-spark" viewBox="0 0 44 14" width={44} height={14} aria-hidden="true">
      <polyline points={points} />
    </svg>
  );
}

export function LevelTable({ value, path, root, info, set, problems, issues }: WidgetProps) {
  const id = useId();
  const levels = (Array.isArray(value) ? value : []) as WeaponLevel[];
  const weapon = getIn(root, path.slice(0, -1)) as { kind?: WeaponKind; evolution?: unknown } | undefined;
  const kind = weapon?.kind;
  const used = new Set<keyof WeaponLevel>(kind && WEAPON_FIELDS[kind] ? WEAPON_FIELDS[kind] : FIELDS);
  const max = weapon?.evolution ? 1 : MAX_LEVELS;
  const kindName = kind ? (VOCABS.weaponKind?.[kind]?.label ?? kind) : null;
  // What the kind reads first, the dimmed rest after: the numbers that matter are in sight on narrow screens.
  const order = [...FIELDS.filter((f) => used.has(f)), ...FIELDS.filter((f) => !used.has(f))];
  const col = (f: keyof WeaponLevel) => describeContent(`weapons[].levels[].${f}`) ?? { label: f };
  const cellProblems = (i: number, f: keyof WeaponLevel) => issues.get(pathKey([...path, i, f]));
  const listed = levels.flatMap((_, i) => FIELDS.flatMap((f) => (cellProblems(i, f) ?? []).map((m) => `${t.levelRow(i + 1)}, ${col(f).label}: ${m}`)));
  const setCell = (i: number, f: keyof WeaponLevel, v: number | undefined) => set(levels.map((l, k) => (k === i ? { ...l, [f]: v } : l)));
  return (
    <div className="cf-field ce-levels">
      <span id={`${id}-l`} className="cf-absent-label">
        {info.label}
      </span>
      {info.hint ? <small className="cf-hint">{info.hint}</small> : null}
      {kindName ? <small className="cf-hint">{t.levelsNote(kindName)}</small> : null}
      <div className="ce-levels-scroll">
        <table aria-labelledby={`${id}-l`}>
          <thead>
            <tr>
              <th scope="col">{t.levelHead}</th>
              {order.map((f) => (
                <th key={f} scope="col" className={used.has(f) ? undefined : 'off'}>
                  <span>{col(f).label}</span>
                  {used.has(f) ? null : <span className="sr-only"> ({t.unusedColumn})</span>}
                  <Spark values={levels.map((l) => l[f] ?? 0)} />
                </th>
              ))}
              <th scope="col">
                <span className="sr-only">{t.levelTools}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {levels.map((l, i) => (
              <tr key={i}>
                <th scope="row">{t.levelRow(i + 1)}</th>
                {order.map((f) => (
                  <td key={f} className={used.has(f) ? undefined : 'off'}>
                    <NumberInput id={`${id}-${i}-${f}`} value={l[f]} info={col(f)} label={t.cell(col(f).label, i + 1)} invalid={!!cellProblems(i, f)?.length} onChange={(v) => setCell(i, f, v)} />
                  </td>
                ))}
                <td>
                  <button type="button" className="cf-icon-btn danger" aria-label={t.removeLevel(i + 1)} disabled={levels.length <= 1} onClick={() => set(levels.filter((_, k) => k !== i))}>
                    <Icon name="trash" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="lip pill small" disabled={levels.length >= max} onClick={() => set([...levels, { ...(levels.at(-1) ?? ({} as WeaponLevel)) }])}>
        <Icon name="plus" />
        <span>{t.addLevel}</span>
      </button>
      {problems?.length || listed.length ? (
        <ul className="cf-problems" role="alert">
          {[...(problems ?? []), ...listed].map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
