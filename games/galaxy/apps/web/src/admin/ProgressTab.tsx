import type { AdminProgress } from "@galaxy/shared";
import { useState } from "react";
import { useAdminProgress } from "../api/admin";
import { errorText } from "../auth/useMe";
import { copy, fmt } from "../copy/es";
import { ActionDialog, type FieldSpec } from "./ActionDialog";

// The «Progreso» tab of a player's page (GDD §16.2 «Editar todo»; M6d-4, DESIGN_SYSTEM §8 tervicies): the gacha luck
// of each pity group, the probes (level, starting weapon, unlocked), the station's machines, the Laboratorio's nodes
// and the season's points. Each row has its change, with the values it has now already in the dialog; raising asks
// only for a reason, taking away also for the admin's password.

const t = copy.admin;
const g = t.progress;

interface Edit {
  title: string;
  path: string;
  fields: FieldSpec[];
  password: (v: Record<string, string>) => boolean;
  build: (v: Record<string, string>) => Record<string, unknown>;
}

const never = () => false;
const yesNo: [string, string][] = [
  ["true", t.yes],
  ["false", t.no],
];

function edits() {
  return {
    luck: (row: AdminProgress["gacha"][number]): Edit => ({
      title: g.luckOf(row.group),
      path: "gacha-luck",
      fields: [
        {
          name: "sinceLegendary",
          label: g.fields.sinceLegendary,
          kind: "number",
          initial: String(row.sinceLegendary),
        },
        {
          name: "sinceFeatured",
          label: g.fields.sinceFeatured,
          kind: "number",
          initial: String(row.sinceFeatured),
        },
        {
          name: "welcome",
          label: g.fields.welcome,
          kind: "select",
          options: yesNo,
          initial: String(row.welcome),
        },
      ],
      password: never,
      build: (v) => ({
        group: row.group,
        sinceLegendary: Number(v["sinceLegendary"]),
        sinceFeatured: Number(v["sinceFeatured"]),
        welcome: v["welcome"] === "true",
      }),
    }),
    probe: (row: AdminProgress["probes"][number]): Edit => ({
      title: g.levelOfProbe(row.name),
      path: "probe",
      fields: [
        {
          name: "level",
          label: g.fields.level,
          kind: "number",
          initial: String(row.level),
          hint: g.probeLevelHint(row.maxLevel),
        },
        {
          name: "variant",
          label: g.fields.variant,
          kind: "select",
          options: [
            ["", g.baseWeapon],
            ...row.variants.map((v): [string, string] => [
              v.id,
              g.variantOpt(v.name, v.unlockAt),
            ]),
          ],
          initial: row.variant ?? "",
        },
      ],
      password: (v) => Number(v["level"]) < row.level,
      build: (v) => ({
        probe: row.probe,
        level: Number(v["level"]),
        variant: v["variant"] || null,
      }),
    }),
    grant: (row: AdminProgress["probes"][number], granted: boolean): Edit => ({
      title: granted ? g.unlockOf(row.name) : g.lockOf(row.name),
      path: "probe-grant",
      fields: [],
      password: () => !granted,
      build: () => ({ probe: row.probe, granted }),
    }),
    room: (row: AdminProgress["rooms"][number]): Edit => ({
      title: g.levelOfRoom(roomName(row.room)),
      path: "room",
      fields: [
        {
          name: "level",
          label: g.fields.level,
          kind: "number",
          initial: String(row.level),
          hint: g.levelHint(row.maxLevel),
        },
      ],
      password: (v) => Number(v["level"]) < row.level,
      build: (v) => ({ room: row.room, level: Number(v["level"]) }),
    }),
    node: (row: AdminProgress["lab"][number]): Edit => ({
      title: g.levelOfNode(row.name),
      path: "lab-node",
      fields: [
        {
          name: "level",
          label: g.fields.level,
          kind: "number",
          initial: String(row.level),
          hint: g.levelHint(row.max),
        },
      ],
      password: (v) => Number(v["level"]) < row.level,
      build: (v) => ({ node: row.node, level: Number(v["level"]) }),
    }),
    season: (): Edit => ({
      title: g.adjustSeason,
      path: "season",
      fields: [
        {
          name: "points",
          label: g.fields.points,
          kind: "number",
          hint: g.pointsHint,
        },
      ],
      password: (v) => Number(v["points"]) < 0,
      build: (v) => ({ points: Number(v["points"]) }),
    }),
  };
}

const roomName = (room: string) =>
  (copy.station.rooms as Record<string, string>)[room] ?? room;

export function ProgressTab({ username }: { username: string }) {
  const progress = useAdminProgress(username);
  const [open, setOpen] = useState<Edit | null>(null);
  const [done, setDone] = useState(false);
  if (!progress.data) {
    return progress.error ? (
      <p className="field-error" role="alert">
        {errorText(progress.error, copy.errors)}
      </p>
    ) : (
      <p className="panel-note">{g.loading}</p>
    );
  }
  const p = progress.data;
  const e = edits();
  const start = (x: Edit) => {
    setDone(false);
    setOpen(x);
  };
  const changeButton = (label: string, x: Edit) => (
    <button
      type="button"
      className="lip pill small"
      aria-label={label}
      aria-haspopup="dialog"
      onClick={() => start(x)}
    >
      {g.change}
    </button>
  );
  return (
    <div className="progress-tab">
      {done ? (
        <p className="admin-done" role="status">
          {t.done}
        </p>
      ) : null}

      <section className="progress-part">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption>{g.gachaTitle}</caption>
            <thead>
              <tr>
                {(
                  [
                    "group",
                    "sinceLegendary",
                    "sinceFeatured",
                    "welcome",
                    "totalPulls",
                  ] as const
                ).map((c) => (
                  <th key={c} scope="col">
                    {g.cols[c]}
                  </th>
                ))}
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {p.gacha.map((row) => (
                <tr key={row.group}>
                  <th scope="row">{row.group}</th>
                  <td>{fmt(row.sinceLegendary)}</td>
                  <td>{fmt(row.sinceFeatured)}</td>
                  <td>{row.welcome ? t.yes : t.no}</td>
                  <td>{fmt(row.totalPulls)}</td>
                  <td>{changeButton(g.luckOf(row.group), e.luck(row))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="progress-part">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption>{g.probesTitle}</caption>
            <thead>
              <tr>
                {(["probe", "level", "weapon", "state"] as const).map((c) => (
                  <th key={c} scope="col">
                    {g.cols[c]}
                  </th>
                ))}
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {p.probes.map((row) => (
                <tr key={row.probe}>
                  <th scope="row">{row.name}</th>
                  <td>{g.levelOf(row.level, row.maxLevel)}</td>
                  <td>
                    {row.variant
                      ? (row.variants.find((v) => v.id === row.variant)?.name ??
                        row.variant)
                      : g.baseWeapon}
                  </td>
                  <td>
                    <span
                      className={`admin-chip ${row.unlocked ? "ok" : "warn"}`}
                    >
                      {row.granted
                        ? g.grantedByAdmin
                        : row.unlocked
                          ? g.unlocked
                          : g.locked}
                    </span>
                  </td>
                  <td className="progress-actions">
                    {changeButton(g.levelOfProbe(row.name), e.probe(row))}
                    {row.granted ? (
                      <button
                        type="button"
                        className="lip pill small danger"
                        aria-haspopup="dialog"
                        onClick={() => start(e.grant(row, false))}
                      >
                        {g.lockOf(row.name)}
                      </button>
                    ) : !row.unlocked ? (
                      <button
                        type="button"
                        className="lip pill small"
                        aria-haspopup="dialog"
                        onClick={() => start(e.grant(row, true))}
                      >
                        {g.unlockOf(row.name)}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="progress-pair">
        <div className="progress-stack">
          <section className="progress-part">
            <div className="admin-table-wrap">
              <table className="admin-table">
                <caption>{g.roomsTitle}</caption>
                <thead>
                  <tr>
                    <th scope="col">{g.cols.room}</th>
                    <th scope="col">{g.cols.level}</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {p.rooms.map((row) => (
                    <tr key={row.room}>
                      <th scope="row">{roomName(row.room)}</th>
                      <td>{g.levelOf(row.level, row.maxLevel)}</td>
                      <td>
                        {changeButton(
                          g.levelOfRoom(roomName(row.room)),
                          e.room(row),
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section
            className="progress-part progress-season"
            aria-labelledby="progress-season-title"
          >
            <h2 id="progress-season-title">{g.seasonTitle}</h2>
            {p.season ? (
              <>
                <p>
                  {g.seasonLine(
                    p.season.name,
                    p.season.points,
                    p.season.adjustments,
                  )}
                </p>
                <button
                  type="button"
                  className="lip pill small"
                  aria-haspopup="dialog"
                  onClick={() => start(e.season())}
                >
                  {g.adjustSeason}
                </button>
              </>
            ) : (
              <p className="panel-note">{g.noSeason}</p>
            )}
          </section>
        </div>
        <section className="progress-part">
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption>{g.labTitle}</caption>
              <thead>
                <tr>
                  <th scope="col">{g.cols.node}</th>
                  <th scope="col">{g.cols.level}</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {p.lab.map((row) => (
                  <tr key={row.node}>
                    <th scope="row">{row.name}</th>
                    <td>{g.levelOf(row.level, row.max)}</td>
                    <td>
                      {changeButton(g.levelOfNode(row.name), e.node(row))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {open ? (
        <ActionDialog
          url={`/admin/players/${encodeURIComponent(username)}/${open.path}`}
          title={open.title}
          fields={open.fields}
          password={open.password}
          build={open.build}
          onDone={() => {
            setOpen(null);
            setDone(true);
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}
