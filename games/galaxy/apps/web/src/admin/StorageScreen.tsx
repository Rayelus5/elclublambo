import type { AdminStorage } from '@galaxy/shared';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ADMIN_KEY } from '../api/admin';
import { api } from '../api/client';
import { useAdminMedia } from '../api/news';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { HScroll } from '../ui/HScroll';

const t = copy.admin.storage;
const whole = new Intl.NumberFormat('es-ES');
const percent = new Intl.NumberFormat('es-ES', { style: 'percent', maximumFractionDigits: 0 });
const time = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
const UNITS = ['B', 'kB', 'MB', 'GB', 'TB'] as const;

/** Bytes in the unit that reads best (powers of 1024, as the disk tools count), one decimal below 100. */
export function formatBytes(bytes: number): string {
  let n = Math.max(0, bytes);
  let unit = 0;
  while (n >= 1024 && unit < UNITS.length - 1) {
    n /= 1024;
    unit++;
  }
  const digits = new Intl.NumberFormat('es-ES', { maximumFractionDigits: n >= 100 || unit === 0 ? 0 : 1 });
  return `${digits.format(n)} ${UNITS[unit]}`;
}

/**
 * «Almacenamiento» (admins only; the owner: «desde admin deberíamos de poder visualizar el almacenamiento del
 * servidor»): the database and the game's part of it, the server's disk with a bar, the galaxies alive and
 * disintegrated (their pictures are drawn in each browser, so the server keeps none), and the biggest tables. Read
 * when the page opens and again on demand.
 */
export function StorageScreen() {
  const storage = useQuery({ queryKey: [...ADMIN_KEY, 'storage'], queryFn: () => api<AdminStorage>('/admin/storage') });
  const s = storage.data;
  return (
    <section className="admin-page stats storage">
      <h1>{copy.admin.sections.storage}</h1>
      <div className="stats-bar">
        <p className="stats-sub">{t.intro}</p>
        {s ? <p className="stats-updated">{t.updated(time.format(new Date(s.readAt)))}</p> : null}
        <button type="button" className="lip pill small" onClick={() => void storage.refetch()} disabled={storage.isFetching}>
          {t.reload}
        </button>
      </div>
      {storage.error ? (
        <p className="field-error" role="alert">
          {errorText(storage.error, copy.errors)}
        </p>
      ) : null}
      {s ? (
        <>
          <Tiles s={s} />
          <Tables s={s} />
        </>
      ) : null}
    </section>
  );
}

function Tile({ label, value, detail, children }: { label: string; value: string; detail?: string; children?: ReactNode }) {
  return (
    <div className="stat-tile" role="group" aria-label={label}>
      <span className="stat-label">{label}</span>
      <b className="stat-value">{value}</b>
      {children}
      {detail ? <span className="stat-detail">{detail}</span> : null}
    </div>
  );
}

function Tiles({ s }: { s: AdminStorage }) {
  const { disk } = s;
  const media = useAdminMedia().data;
  const used = disk ? disk.totalBytes - disk.freeBytes : 0;
  const share = disk && disk.totalBytes > 0 ? used / disk.totalBytes : 0;
  return (
    <div className="stat-tiles">
      <Tile label={t.tiles.database} value={formatBytes(s.database.bytes)} detail={t.tiles.game(formatBytes(s.database.gameBytes))} />
      {disk ? (
        <Tile label={t.tiles.disk} value={formatBytes(disk.freeBytes)} detail={t.tiles.used(formatBytes(used), formatBytes(disk.totalBytes), percent.format(share))}>
          <span className={`storage-meter${share >= 0.85 ? ' full' : ''}`} aria-hidden="true">
            <span style={{ inlineSize: `${Math.min(100, share * 100)}%` }} />
          </span>
        </Tile>
      ) : (
        <Tile label={t.tiles.disk} value="—" detail={t.tiles.noDisk} />
      )}
      <Tile label={t.tiles.galaxies} value={whole.format(s.galaxies.live + s.galaxies.disintegrated)} detail={t.tiles.alive(whole.format(s.galaxies.live), whole.format(s.galaxies.disintegrated))} />
      <Tile label={t.tiles.galaxiesTable} value={formatBytes(s.galaxies.bytes)} detail={t.tiles.galaxiesTableDetail} />
      <Tile label={t.tiles.images} value={formatBytes(0)} detail={t.tiles.imagesDetail} />
      {media?.assets ? <Tile label={t.tiles.newsImages} value={formatBytes(media.totalBytes)} detail={t.tiles.newsImagesDetail(media.assets.length)} /> : null}
    </div>
  );
}

function Tables({ s }: { s: AdminStorage }) {
  return (
    <section className="lip panel stats-section" aria-labelledby="storage-tables">
      <header className="stats-head">
        <h2 id="storage-tables">{t.tablesTitle}</h2>
      </header>
      <HScroll variant="table" className="admin-table-wrap">
        <table className="admin-table storage-tables" aria-labelledby="storage-tables">
          <thead>
            <tr>
              <th scope="col">{t.table}</th>
              <th scope="col">{t.rows}</th>
              <th scope="col">{t.size}</th>
              <th scope="col">{t.indexes}</th>
            </tr>
          </thead>
          <tbody>
            {s.tables.map((x) => (
              <tr key={x.name}>
                <th scope="row">{x.name}</th>
                <td>{x.rows === null ? t.noEstimate : whole.format(x.rows)}</td>
                <td>{formatBytes(x.bytes)}</td>
                <td>{formatBytes(x.indexBytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </HScroll>
    </section>
  );
}
