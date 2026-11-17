import type { AdminLoadSample } from '@galaxy/shared';
import { useId, useState, type PointerEvent } from 'react';
import { useAdminLoad } from '../api/rooms';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { HScroll } from '../ui/HScroll';

// «Carga del servidor» (2026-11-17, the owner: «ver la carga del multijugador en el servidor desde el admin será útil
// para la monitorización»), over Moderación › Salas en vivo: the numbers now in stat tiles, the last hour as a small
// line in the four that move most (one series each: no legend, the tile's label names it; the newest point in the
// accent, the rest in the quiet ink), with a tooltip on hover and its summary for screen readers, and the whole hour in a
// table. Every 5 s; the server samples every 15 s and forgets on each deploy.

const L = copy.admin.moderation.load;
const num = new Intl.NumberFormat('es-ES');
const pct = new Intl.NumberFormat('es-ES', { style: 'percent', maximumFractionDigits: 1 });
const dec = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const clock = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Madrid' });

const open = (s: AdminLoadSample) => s.rooms.lobby + s.rooms.starting + s.rooms.running;
const mb = (bytes: number) => `${num.format(Math.round(bytes / 1_048_576))} MB`;
const ms = (n: number) => `${dec.format(n)} ms`;
function since(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

const W = 160;
const H = 34;

/** The last hour of one number: a 2 px line in the quiet ink, the newest point in the accent, a hairline and tooltip on hover. */
function Spark({ label, values, at, format }: { label: string; values: number[]; at: string[]; format: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (values.length < 2) return <span className="load-spark empty" aria-hidden="true" />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = (i: number) => (i / (values.length - 1)) * (W - 6) + 3;
  const y = (v: number) => (hi === lo ? H / 2 : H - 4 - ((v - lo) / (hi - lo)) * (H - 8));
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width <= 0) return;
    setHover(Math.max(0, Math.min(last, Math.round(((e.clientX - r.left) / r.width) * last))));
  };
  return (
    <span className="load-spark">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={L.trend(label, format(lo), format(hi), values.length)} onPointerMove={move} onPointerLeave={() => setHover(null)}>
        <polyline points={points} />
        {hover !== null ? <line className="load-hair" x1={x(hover)} x2={x(hover)} y1={0} y2={H} /> : null}
        <circle className="load-now" cx={x(hover ?? last)} cy={y(values[hover ?? last]!)} r={3} />
      </svg>
      {hover !== null ? (
        <span className="load-tip" aria-hidden="true">
          <b>{format(values[hover]!)}</b>
          <span>{clock.format(new Date(at[hover]!))}</span>
        </span>
      ) : null}
    </span>
  );
}

function Tile({ label, value, hint, trend }: { label: string; value: string; hint?: string; trend?: { values: number[]; at: string[]; format: (n: number) => string } }) {
  return (
    <div className="load-tile">
      <span className="load-label">{label}</span>
      <b className="load-value">{value}</b>
      {hint ? <span className="load-hint">{hint}</span> : null}
      {trend ? <Spark label={label} {...trend} /> : null}
    </div>
  );
}

export function ServerLoad() {
  const id = useId();
  const load = useAdminLoad();
  const v = load.data;
  if (load.error && !v) {
    return (
      <p className="field-error" role="alert">
        {errorText(load.error, copy.errors)}
      </p>
    );
  }
  if (!v) return null;
  const n = v.now;
  const h = v.history;
  const at = h.map((s) => s.at);
  const t = L.tiles;
  return (
    <section className="lip panel load" aria-labelledby={id}>
      <div className="load-head">
        <h2 id={id}>{L.title}</h2>
        <p className="panel-note">{L.note}</p>
      </div>
      <div className="load-tiles">
        <Tile label={t.rooms} value={`${open(n)}/${n.rooms.max}`} hint={L.roomsHint(n.rooms.lobby + n.rooms.starting, n.rooms.running)} trend={{ values: h.map(open), at, format: (x) => num.format(x) }} />
        <Tile label={t.players} value={num.format(n.players)} trend={{ values: h.map((s) => s.players), at, format: (x) => num.format(x) }} />
        <Tile label={t.coop} value={num.format(n.coop.runs)} hint={L.coopHint(n.coop.connected)} />
        <Tile label={t.solo} value={num.format(n.solo)} />
        <Tile label={t.sockets} value={num.format(n.sockets)} />
        <Tile label={t.cpu} value={pct.format(n.cpu)} hint={L.cpuHint} trend={{ values: h.map((s) => s.cpu), at, format: (x) => pct.format(x) }} />
        <Tile label={t.referee} value={pct.format(n.referee.core)} hint={L.refereeHint(ms(n.referee.p99))} />
        <Tile label={t.loop} value={ms(n.loop.p99)} hint={L.loopHint(ms(n.loop.p50), ms(n.loop.max))} trend={{ values: h.map((s) => s.loop.p99), at, format: ms }} />
        <Tile label={t.memory} value={mb(n.memory.rss)} hint={L.memoryHint(mb(n.memory.heap))} />
        <Tile label={t.uptime} value={since(n.uptime)} />
      </div>
      {h.length > 0 ? (
        <details className="load-table">
          <summary>{L.showTable}</summary>
          <HScroll variant="table" className="admin-table-wrap">
            <table className="admin-table">
              <caption>{L.table}</caption>
              <thead>
                <tr>
                  {(['at', 'rooms', 'players', 'coop', 'cpu', 'loop'] as const).map((c) => (
                    <th key={c} scope="col">
                      {L.cols[c]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...h].reverse().map((s) => (
                  <tr key={s.at}>
                    <td>{clock.format(new Date(s.at))}</td>
                    <td>{`${open(s)}/${s.rooms.max}`}</td>
                    <td>{num.format(s.players)}</td>
                    <td>{L.coopValue(s.coop.runs, s.coop.connected)}</td>
                    <td>{pct.format(s.cpu)}</td>
                    <td>{ms(s.loop.p99)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </HScroll>
        </details>
      ) : null}
    </section>
  );
}
