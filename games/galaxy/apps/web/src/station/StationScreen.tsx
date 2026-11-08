import type { RoomId, StationRoomView, StationView } from '@galaxy/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { useMyClan } from '../api/clans';
import { useMailbox } from '../api/mail';
import { useCollectAntenna, useCollectRefinery, useLoadRefinery, useStation, useUpgradeRoom } from '../api/station';
import { errorText } from '../auth/useMe';
import { copy, fmt } from '../copy/es';
import { MailboxDialog } from '../mail/Mailbox';
import { useUi } from '../state/ui';
import { Dialog } from '../ui/Dialog';
import { Icon, type IconName } from '../ui/Icon';
import { roomSheet, roomSheetUrl } from './art';
import { HomeLink } from '../ui/BackLink';

// The station (GDD §10, DESIGN_SYSTEM §8 septies): the base is the menu. Two decks of five rooms in a side cut; a
// working tool opens its screen, the machines (refinery, antenna) and Comunicaciones open their panels, a broken room
// shows what repairing it costs. A machine with something to collect says «Listo» on its plate. Every action answers
// with the new view.

const t = copy.station;

/** Where each working tool leads (Comunicaciones opens its panel instead). */
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
function Art({ room, className = 'room-art' }: { room: StationRoomView; className?: string }) {
  const state = room.state === 'working' ? 'working' : 'broken';
  const url = roomSheetUrl(room.id, state, room.level);
  return <span className={className} aria-hidden="true" data-sheet={roomSheet(room.id, state, room.level)} style={url ? { backgroundImage: `url(${url})` } : undefined} />;
}

function Plate({ room, ready }: { room: StationRoomView; ready: boolean }) {
  const line = room.state === 'future' ? t.repairing : room.state === 'broken' ? t.broken : room.maxLevel > 1 ? t.level(room.level) : t.hints[room.id];
  return (
    <span className="room-plate">
      <b>{t.rooms[room.id]}</b>
      <small>{line}</small>
      {ready ? <span className="room-ready">{t.ready}</span> : null}
    </span>
  );
}

function Room({ room, ready, onOpen }: { room: StationRoomView; ready: boolean; onOpen: (id: RoomId) => void }) {
  const to = SCREEN[room.id];
  if (room.state === 'future') {
    return (
      <div className="room is-future">
        <Art room={room} />
        <Plate room={room} ready={false} />
      </div>
    );
  }
  if (to && room.state === 'working') {
    return (
      <Link to={to} className="room is-tool" state={room.id === 'collider' ? { fuse: true } : undefined}>
        <Art room={room} />
        <Plate room={room} ready={false} />
      </Link>
    );
  }
  return (
    <button type="button" className={`room ${room.state === 'broken' ? 'is-broken' : room.maxLevel > 1 ? 'is-machine' : 'is-tool'}${ready ? ' has-ready' : ''}`} onClick={() => onOpen(room.id)}>
      <Art room={room} />
      <Plate room={room} ready={ready} />
    </button>
  );
}

/** A panel's head: the room's art, big, and its level. */
function PanelHead({ room, lead }: { room: StationRoomView; lead: string }) {
  return (
    <div className="panel-head">
      <Art room={room} className="room-art panel-art" />
      <div>
        {room.maxLevel > 1 ? <span className="panel-level">{room.level === 0 ? t.broken : t.levelOf(room.level, room.maxLevel)}</span> : null}
        <p className="panel-lead">{lead}</p>
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <div className="panel-stat">
      <Icon name={icon} />
      <span>
        <small>{label}</small>
        <b>{value}</b>
      </span>
    </div>
  );
}

/** «Reparar» or «Mejorar a nivel N»: what the next level gives against now, its cost, and what is missing. */
function Upgrade({ room, view }: { room: StationRoomView; view: StationView }) {
  const upgrade = useUpgradeRoom();
  if (!room.next) return <p className="panel-maxed">{t.maxed}</p>;
  const { components, coins } = room.next.cost;
  const short = { components: Math.max(0, components - (view.wallet['components'] ?? 0)), coins: Math.max(0, coins - view.wallet.coins) };
  const affordable = short.components === 0 && short.coins === 0;
  const label = room.level === 0 ? t.repair : t.upgrade(room.level + 1);
  const gives = room.next.gives;
  const rows: [string, string, string][] = [];
  if (gives && room.id === 'refinery') {
    rows.push([t.refinery.rateLabel, t.refinery.rate(view.refinery.rate), t.refinery.rate(gives.rate)]);
    if (gives.capacity !== undefined) rows.push([t.refinery.capacityLabel, fmt(view.refinery.capacity), fmt(gives.capacity)]);
  }
  if (gives && room.id === 'antenna') rows.push([t.antenna.rateLabel, room.level === 0 ? t.antenna.silent : t.antenna.rate(view.antenna.rate), t.antenna.rate(gives.rate)]);
  return (
    <section className="panel-upgrade" aria-label={label}>
      <h3>{room.level === 0 ? t.repairTitle : t.nextLevel}</h3>
      {rows.length > 0 ? (
        <ul className="panel-compare">
          {rows.map(([what, now, next]) => (
            <li key={what}>
              <span>{what}</span>
              <span className="now">{now}</span>
              <Icon name="back" />
              <b>{next}</b>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="panel-cost">
        <span className={short.components > 0 ? 'short' : undefined}>
          <Icon name="wrench" />
          {fmt(components)}
        </span>
        {coins > 0 ? (
          <span className={short.coins > 0 ? 'short' : undefined}>
            <Icon name="coin" />
            {fmt(coins)}
          </span>
        ) : null}
        <button type="button" className="lip pill pill-solar station-upgrade" disabled={!affordable || upgrade.isPending} aria-label={`${label}: ${t.cost(components, coins)}`} onClick={() => upgrade.mutate({ id: room.id, level: room.level + 1 })}>
          <Icon name="wrench" />
          <span>{label}</span>
        </button>
      </div>
      {affordable ? null : <p className="panel-note">{t.missing(short.components, short.coins)}</p>}
      {upgrade.error ? (
        <p className="field-error" role="alert">
          {errorText(upgrade.error, copy.errors)}
        </p>
      ) : null}
    </section>
  );
}

/** «2 h 15 min», «40 min» or «menos de 1 min». */
function duration(hours: number): string {
  const min = Math.ceil(hours * 60);
  if (min < 1) return t.lessThanMinute;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? (m > 0 ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

function RefineryPanel({ view, onClose }: { view: StationView; onClose: () => void }) {
  const r = view.refinery;
  const room = view.rooms.find((x) => x.id === 'refinery')!;
  const material = view.wallet['material'] ?? 0;
  const fits = Math.max(0, Math.min(material, r.capacity - r.queue));
  // What the player chose, kept within what fits now (also after a load changes the view).
  const [chosen, setChosen] = useState<number | null>(null);
  const amount = Math.min(chosen ?? fits, fits);
  const load = useLoadRefinery();
  const collect = useCollectRefinery();
  const error = load.error ?? collect.error;
  const presets: [string, number][] = [
    [t.refinery.quarter, Math.max(1, Math.floor(fits / 4))],
    [t.refinery.half, Math.max(1, Math.floor(fits / 2))],
    [t.refinery.all, fits],
  ];
  return (
    <Dialog title={t.rooms.refinery} onClose={onClose} className="station-panel">
      <PanelHead room={room} lead={t.refinery.lead} />
      <div className="panel-stats">
        <Stat icon="cube" label={t.refinery.rateLabel} value={t.refinery.rate(r.rate)} />
        <Stat icon="wrench" label={t.refinery.ready} value={fmt(r.ready)} />
        <Stat icon="station" label={t.refinery.capacityLabel} value={fmt(r.capacity)} />
      </div>
      <div className="panel-meter">
        <span className="panel-bar-label">
          <span>{t.refinery.queue}</span>
          <b>
            {fmt(r.queue)} / {fmt(r.capacity)}
          </b>
        </span>
        <span className="panel-bar" role="progressbar" aria-label={t.refinery.queue} aria-valuemin={0} aria-valuemax={r.capacity} aria-valuenow={r.queue}>
          <i style={{ inlineSize: `${(r.queue / Math.max(1, r.capacity)) * 100}%` }} />
        </span>
        <small>{r.queue > 0 ? t.refinery.finishesIn(duration(r.queue / r.rate)) : material === 0 ? t.refinery.empty : t.refinery.idle}</small>
      </div>
      {r.ready > 0 ? (
        <button type="button" className="lip pill pill-solar panel-primary" disabled={collect.isPending} onClick={() => collect.mutate()}>
          <Icon name="wrench" />
          <span>{t.refinery.collect(r.ready)}</span>
        </button>
      ) : null}
      {fits > 0 ? (
        <section className="panel-load" aria-label={t.refinery.loadTitle}>
          <h3>{t.refinery.loadTitle}</h3>
          <div className="panel-slider">
            <input type="range" min={1} max={fits} step={1} value={Math.max(1, amount)} aria-label={t.refinery.amount} aria-valuetext={t.refinery.amountOf(amount)} onChange={(e) => setChosen(Number(e.target.value))} />
            <output>{fmt(amount)}</output>
          </div>
          <div className="panel-presets">
            {presets.map(([label, n]) => (
              <button key={label} type="button" className="lip pill small" aria-pressed={amount === n} onClick={() => setChosen(n)}>
                {label}
              </button>
            ))}
            <button type="button" className="lip pill panel-load-go" disabled={amount < 1 || load.isPending} onClick={() => load.mutate(amount)}>
              <Icon name="cube" />
              <span>{t.refinery.loadN(amount)}</span>
            </button>
          </div>
        </section>
      ) : null}
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
      <PanelHead room={room} lead={id === 'lab' ? t.labLead : t.hints[id]} />
      <Upgrade room={room} view={view} />
    </Dialog>
  );
}

function AntennaPanel({ view, onClose }: { view: StationView; onClose: () => void }) {
  const a = view.antenna;
  const room = view.rooms.find((x) => x.id === 'antenna')!;
  const collect = useCollectAntenna();
  const cap = Math.max(1, Math.floor(a.rate * a.capHours));
  return (
    <Dialog title={t.rooms.antenna} onClose={onClose} className="station-panel">
      <PanelHead room={room} lead={a.level === 0 ? t.antenna.broken : t.antenna.lead(a.capHours)} />
      {a.level > 0 ? (
        <>
          <div className="panel-stats">
            <Stat icon="radar" label={t.antenna.rateLabel} value={t.antenna.rate(a.rate)} />
            <Stat icon="ticket" label={t.antenna.waiting} value={t.antenna.accrued(a.accrued)} />
          </div>
          <div className="panel-meter">
            <span className="panel-bar-label">
              <span>{t.antenna.fill}</span>
              <b>
                {fmt(a.accrued)} / {fmt(cap)}
              </b>
            </span>
            <span className="panel-bar signal" role="progressbar" aria-label={t.antenna.fill} aria-valuemin={0} aria-valuemax={cap} aria-valuenow={Math.min(a.accrued, cap)}>
              <i style={{ inlineSize: `${Math.min(100, (a.accrued / cap) * 100)}%` }} />
            </span>
            {a.fullAt ? <small>{fillsAt(a.fullAt)}</small> : null}
          </div>
          {a.accrued > 0 ? (
            <button type="button" className="lip pill pill-solar panel-primary" disabled={collect.isPending} onClick={() => collect.mutate()}>
              <Icon name="ticket" />
              <span>{t.antenna.collectN(a.accrued)}</span>
            </button>
          ) : null}
          {collect.error ? (
            <p className="field-error" role="alert">
              {errorText(collect.error, copy.errors)}
            </p>
          ) : null}
        </>
      ) : null}
      <Upgrade room={room} view={view} />
    </Dialog>
  );
}

/** Comunicaciones (GDD §10: market, trade and mailbox): one panel with the ways to the others. */
function CommsPanel({ view, onClose }: { view: StationView; onClose: () => void }) {
  const room = view.rooms.find((x) => x.id === 'comms')!;
  const unread = useMailbox().data?.unread ?? 0;
  const clan = useMyClan().data;
  const openChat = useUi((s) => s.openChat);
  const [mail, setMail] = useState(false);
  const c = t.comms;
  return (
    <Dialog title={t.rooms.comms} onClose={onClose} className="station-panel comms-panel">
      <PanelHead room={room} lead={c.lead} />
      <ul className="comms-links">
        <li>
          <Link to="/mercado" className="lip panel comms-link k-solar">
            <Icon name="store" />
            <b>{c.market}</b>
            <small>{c.marketHint}</small>
          </Link>
        </li>
        <li>
          <Link to="/mercado?pestana=trueques" className="lip panel comms-link k-ice">
            <Icon name="cards" />
            <b>{c.trades}</b>
            <small>{c.tradesHint}</small>
          </Link>
        </li>
        <li>
          <button type="button" className="lip panel comms-link k-nova" onClick={() => setMail(true)}>
            <Icon name="mail" />
            <b>{c.mail}</b>
            <small>{unread > 0 ? c.unread(unread) : c.mailHint}</small>
            {unread > 0 ? <span className="comms-badge">{unread > 9 ? '9+' : fmt(unread)}</span> : null}
          </button>
        </li>
        <li>
          <button
            type="button"
            className="lip panel comms-link k-terminal"
            onClick={() => {
              onClose();
              openChat('global');
            }}
          >
            <Icon name="chat" />
            <b>{c.community}</b>
            <small>{c.communityHint}</small>
          </button>
        </li>
        <li>
          <Link to="/clanes" className="lip panel comms-link k-uv">
            <Icon name="clan" />
            <b>{clan ? c.myClan(clan.tag) : c.clans}</b>
            <small>{clan ? clan.name : c.clansHint}</small>
          </Link>
        </li>
      </ul>
      {mail ? <MailboxDialog onClose={() => setMail(false)} /> : null}
    </Dialog>
  );
}

export function StationScreen() {
  const station = useStation();
  const [open, setOpen] = useState<RoomId | null>(null);
  const view = station.data;
  const ready = (id: RoomId) => (id === 'refinery' ? (view?.refinery.ready ?? 0) > 0 : id === 'antenna' ? (view?.antenna.accrued ?? 0) > 0 : false);
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
                  <Room room={room} ready={ready(room.id)} onOpen={setOpen} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {view && open === 'refinery' ? <RefineryPanel view={view} onClose={() => setOpen(null)} /> : null}
        {view && open === 'antenna' ? <AntennaPanel view={view} onClose={() => setOpen(null)} /> : null}
        {view && open === 'comms' ? <CommsPanel view={view} onClose={() => setOpen(null)} /> : null}
        {view && open && open !== 'refinery' && open !== 'antenna' && open !== 'comms' ? <RepairPanel id={open} view={view} onClose={() => setOpen(null)} /> : null}
      </div>
    </div>
  );
}

export default StationScreen;
