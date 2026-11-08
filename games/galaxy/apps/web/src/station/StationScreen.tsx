import type { RoomId, StationRoomView, StationView } from '@galaxy/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { useCollectAntenna, useCollectRefinery, useLoadRefinery, useStation, useUpgradeRoom } from '../api/station';
import { errorText } from '../auth/useMe';
import { copy, fmt } from '../copy/es';
import { Dialog } from '../ui/Dialog';
import { Icon, type IconName } from '../ui/Icon';
import { roomSheet, roomSheetUrl } from './art';
import { HomeLink } from '../ui/BackLink';

// The station (GDD §10, DESIGN_SYSTEM §8 septies): the base is the menu. Two decks of five rooms in a side cut; a
// working tool opens its screen, the refinery and the antenna open their panels, a broken room shows what repairing it
// costs, and the rooms of later milestones say «En reparación». Every action answers with the new view.

const t = copy.station;

/** Where each working tool leads. */
const SCREEN: Partial<Record<RoomId, string>> = { scanner: '/escaner', planetarium: '/planetario', hangar: '/incursion', collider: '/coleccion', lab: '/laboratorio', archive: '/codice', trophies: '/trofeos' };

function Resource({ kind, icon, amount, label }: { kind: string; icon: IconName; amount: number; label: string }) {
  return (
    <span className={`res ${kind}`} role="img" aria-label={label} title={label}>
      <Icon name={icon} />
      <b aria-hidden="true">{fmt(amount)}</b>
    </span>
  );
}

/** The room's Aseprite strip, played by CSS (still on its first frame with reduced motion). */
function Art({ room }: { room: StationRoomView }) {
  const state = room.state === 'working' ? 'working' : 'broken';
  const url = roomSheetUrl(room.id, state, room.level);
  return <span className="room-art" aria-hidden="true" data-sheet={roomSheet(room.id, state, room.level)} style={url ? { backgroundImage: `url(${url})` } : undefined} />;
}

function Plate({ room }: { room: StationRoomView }) {
  const line = room.state === 'future' ? t.repairing : room.state === 'broken' ? t.broken : room.maxLevel > 1 ? t.level(room.level) : t.hints[room.id];
  return (
    <span className="room-plate">
      <b>{t.rooms[room.id]}</b>
      <small>{line}</small>
    </span>
  );
}

function Room({ room, onOpen }: { room: StationRoomView; onOpen: (id: RoomId) => void }) {
  const to = SCREEN[room.id];
  if (room.state === 'future') {
    return (
      <div className="room is-future">
        <Art room={room} />
        <Plate room={room} />
      </div>
    );
  }
  if (to && room.state === 'working') {
    return (
      <Link to={to} className="room is-tool" state={room.id === 'collider' ? { fuse: true } : undefined}>
        <Art room={room} />
        <Plate room={room} />
      </Link>
    );
  }
  return (
    <button type="button" className={`room ${room.state === 'broken' ? 'is-broken' : 'is-machine'}`} onClick={() => onOpen(room.id)}>
      <Art room={room} />
      <Plate room={room} />
    </button>
  );
}

/** «Mejorar a nivel N» or «Reparar», with its cost; disabled without the components and coins. */
function Upgrade({ room, view }: { room: StationRoomView; view: StationView }) {
  const upgrade = useUpgradeRoom();
  if (!room.next) return <p className="panel-note">{t.maxed}</p>;
  const { components, coins } = room.next.cost;
  const short = { components: Math.max(0, components - (view.wallet['components'] ?? 0)), coins: Math.max(0, coins - view.wallet.coins) };
  const affordable = short.components === 0 && short.coins === 0;
  const label = room.level === 0 ? t.repair : t.upgrade(room.level + 1);
  return (
    <>
      <button type="button" className="lip pill pill-solar station-upgrade" disabled={!affordable || upgrade.isPending} onClick={() => upgrade.mutate({ id: room.id, level: room.level + 1 })}>
        <Icon name="wrench" />
        <span>{label}</span>
        <small>{t.cost(components, coins)}</small>
      </button>
      {affordable ? null : <p className="panel-note">{t.missing(short.components, short.coins)}</p>}
      {upgrade.error ? (
        <p className="field-error" role="alert">
          {errorText(upgrade.error, copy.errors)}
        </p>
      ) : null}
    </>
  );
}

function RefineryPanel({ view, onClose }: { view: StationView; onClose: () => void }) {
  const r = view.refinery;
  const room = view.rooms.find((x) => x.id === 'refinery')!;
  const material = view.wallet['material'] ?? 0;
  const fits = Math.max(0, Math.min(material, r.capacity - r.queue));
  // What the player typed, kept within what fits now (also after a load changes the view).
  const [typed, setTyped] = useState<number | null>(null);
  const amount = Math.min(typed ?? fits, fits);
  const load = useLoadRefinery();
  const collect = useCollectRefinery();
  const error = load.error ?? collect.error;
  return (
    <Dialog title={t.rooms.refinery} onClose={onClose} className="station-panel">
      <p className="panel-lead">{t.refinery.lead}</p>
      <dl className="panel-stats">
        <div>
          <dt>{t.levelLabel}</dt>
          <dd>{room.level}</dd>
        </div>
        <div>
          <dt>{t.refinery.rateLabel}</dt>
          <dd>{t.refinery.rate(r.rate)}</dd>
        </div>
        <div>
          <dt>{t.refinery.ready}</dt>
          <dd>{fmt(r.ready)}</dd>
        </div>
      </dl>
      <span className="panel-bar-label">
        {t.refinery.queue} · {fmt(r.queue)}/{fmt(r.capacity)}
      </span>
      <span className="panel-bar" role="progressbar" aria-label={t.refinery.queue} aria-valuemin={0} aria-valuemax={r.capacity} aria-valuenow={r.queue}>
        <i style={{ inlineSize: `${(r.queue / Math.max(1, r.capacity)) * 100}%` }} />
      </span>
      {material === 0 && r.queue === 0 ? <p className="panel-note">{t.refinery.empty}</p> : null}
      <div className="panel-row">
        <label className="panel-field">
          <span>{t.refinery.amount}</span>
          <input type="number" min={1} max={fits || 1} value={amount} onChange={(e) => setTyped(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
        </label>
        <button type="button" className="lip pill" disabled={amount < 1 || load.isPending} onClick={() => load.mutate(amount)}>
          <Icon name="cube" />
          <span>{t.refinery.load}</span>
        </button>
      </div>
      <button type="button" className="lip pill pill-solar" disabled={r.ready < 1 || collect.isPending} onClick={() => collect.mutate()}>
        <Icon name="wrench" />
        <span>{t.refinery.collect(r.ready)}</span>
      </button>
      <Upgrade room={room} view={view} />
      {error ? (
        <p className="field-error" role="alert">
          {errorText(error, copy.errors)}
        </p>
      ) : null}
    </Dialog>
  );
}

/** «Se llena a las 14:00», «mañana a las…» or «el sábado a las…» (capHours is live config), or «Ya está llena». */
function fillsAt(iso: string): string {
  const at = new Date(iso);
  const now = new Date();
  if (at.getTime() <= now.getTime()) return t.antenna.full;
  const time = at.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((new Date(at).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000);
  return t.antenna.fullAt(time, days === 0 ? 'today' : days === 1 ? 'tomorrow' : at.toLocaleDateString('es-ES', { weekday: 'long' }));
}

/** A broken room that opens a screen once repaired (the Laboratorio, M4b-2): what it is for, and its repair. */
function RepairPanel({ id, view, onClose }: { id: RoomId; view: StationView; onClose: () => void }) {
  const room = view.rooms.find((x) => x.id === id);
  if (!room) return null;
  return (
    <Dialog title={t.rooms[id]} onClose={onClose} className="station-panel">
      <p className="panel-lead">{id === 'lab' ? t.labLead : t.hints[id]}</p>
      <Upgrade room={room} view={view} />
    </Dialog>
  );
}

function AntennaPanel({ view, onClose }: { view: StationView; onClose: () => void }) {
  const a = view.antenna;
  const room = view.rooms.find((x) => x.id === 'antenna')!;
  const collect = useCollectAntenna();
  return (
    <Dialog title={t.rooms.antenna} onClose={onClose} className="station-panel">
      {a.level === 0 ? (
        <p className="panel-lead">{t.antenna.broken}</p>
      ) : (
        <>
          <p className="panel-lead">{t.antenna.lead(a.capHours)}</p>
          <dl className="panel-stats">
            <div>
              <dt>{t.levelLabel}</dt>
              <dd>{a.level}</dd>
            </div>
            <div>
              <dt>{t.antenna.rateLabel}</dt>
              <dd>{t.antenna.rate(a.rate)}</dd>
            </div>
            <div>
              <dt>{t.antenna.waiting}</dt>
              <dd>{t.antenna.accrued(a.accrued)}</dd>
            </div>
          </dl>
          {a.fullAt ? <p className="panel-note">{fillsAt(a.fullAt)}</p> : null}
          <button type="button" className="lip pill pill-solar" disabled={a.accrued < 1 || collect.isPending} onClick={() => collect.mutate()}>
            <Icon name="ticket" />
            <span>{t.antenna.collect}</span>
          </button>
          {collect.error ? (
            <p className="field-error" role="alert">
              {errorText(collect.error, copy.errors)}
            </p>
          ) : null}
        </>
      )}
      <Upgrade room={room} view={view} />
    </Dialog>
  );
}

export function StationScreen() {
  const station = useStation();
  const [open, setOpen] = useState<RoomId | null>(null);
  const view = station.data;
  return (
    <div className="screen-root station-root">
      <div className="station">
        <header className="collection-bar">
          <HomeLink>
            <Icon name="back" />
            <span>{t.back}</span>
          </HomeLink>
          <h1>{t.title}</h1>
          <div className="lip panel hud">
            {view ? (
              <>
                <Resource kind="material" icon="cube" amount={view.wallet['material'] ?? 0} label={t.resource.material(view.wallet['material'] ?? 0)} />
                <Resource kind="components" icon="wrench" amount={view.wallet['components'] ?? 0} label={t.resource.components(view.wallet['components'] ?? 0)} />
                <Resource kind="coins" icon="coin" amount={view.wallet.coins} label={copy.hub.resource.coins(view.wallet.coins)} />
                <Resource kind="signal" icon="ticket" amount={view.wallet.signal} label={copy.hub.resource.signal(view.wallet.signal)} />
              </>
            ) : (
              <span className="res pending" role="img" aria-label={copy.loading}>
                ⠋⠙⠹
              </span>
            )}
          </div>
        </header>
        {station.error ? (
          <p className="field-error" role="alert">
            {errorText(station.error, copy.errors)}
          </p>
        ) : null}
        {view ? (
          <div className="station-hull">
            <ul className="station-decks" aria-label={t.title}>
              {view.rooms.map((room) => (
                <li key={room.id}>
                  <Room room={room} onOpen={setOpen} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {view && open === 'refinery' ? <RefineryPanel view={view} onClose={() => setOpen(null)} /> : null}
        {view && open === 'antenna' ? <AntennaPanel view={view} onClose={() => setOpen(null)} /> : null}
        {view && open && open !== 'refinery' && open !== 'antenna' ? <RepairPanel id={open} view={view} onClose={() => setOpen(null)} /> : null}
      </div>
    </div>
  );
}

export default StationScreen;
