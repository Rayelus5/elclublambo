import type { HangarView, RoomMember, RoomView } from '@galaxy/shared';
import { type CSSProperties, useState } from 'react';
import { Link } from 'react-router';
import { useRoomAction } from '../../api/rooms';
import { useChooseProbe } from '../../api/runs';
import { spriteDataUrl } from '../../arena/sprites';
import { errorText } from '../../auth/useMe';
import { copy } from '../../copy/es';
import { Icon } from '../../ui/Icon';
import { playEquip } from '../../workshop/sfx';
import padUrl from '../lobby-art/launchpad.png';
import { Avatar } from '../../hub/Avatar';

// The lobby's stage: solo or in a group over it (the two buttons, centred), my probe floating over its launch pad in the middle (the pad painted
// in Aseprite, art/lobby/paint-lobby.lua), and in a room my teammates on their own pads at its sides. The probe is the
// way into the workshop (the owner: «que el usuario pueda pulsar tal cual en su sonda»); the arrows beside it change
// the probe I fly with among the ones I have.

const l = copy.lobby;
const t = copy.coop;
export type Mode = 'solo' | 'group';

function ModeTabs({ mode, room, onMode }: { mode: Mode; room: RoomView | null; onMode: (m: Mode) => void }) {
  return (
    <div className="lobby-who">
      <div className="lobby-modes" role="radiogroup" aria-label={l.who}>
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'solo'}
          className="lip lobby-mode solo"
          disabled={!!room}
          title={room ? l.soloLocked : undefined}
          onClick={() => onMode('solo')}
          data-sfx="hover"
        >
          <Icon name="probe" />
          <span>
            <b>{l.solo}</b>
            {room ? <small>{l.soloLocked}</small> : null}
          </span>
        </button>
        <button type="button" role="radio" aria-checked={mode === 'group'} className="lip lobby-mode group" onClick={() => onMode('group')} data-sfx="hover">
          <Icon name="clan" />
          <span>
            <b>{l.group}</b>
            {room ? <small>{l.inRoom(room.members.length, room.max)}</small> : null}
          </span>
        </button>
      </div>
    </div>
  );
}

function Hero({ view, self }: { view: HangarView; self: RoomMember | null }) {
  const choose = useChooseProbe();
  const [dir, setDir] = useState<1 | -1>(1);
  const open = view.probes.filter((p) => p.unlocked);
  const id = (choose.isPending ? choose.variables : null) ?? view.probe;
  const probe = view.probes.find((p) => p.id === id) ?? open[0];
  if (!probe) return null;
  const at = open.findIndex((p) => p.id === probe.id);
  // A teammate who said «listo» flies what they said it with.
  const fixed = open.length < 2 || choose.isPending || !!self?.ready;
  const turn = (d: 1 | -1) => {
    if (fixed) return;
    const next = open[(at + d + open.length) % open.length]!;
    setDir(d);
    choose.mutate(next.id, { onSuccess: () => playEquip() });
  };
  const weapon = probe.variants.find((w) => w.id === probe.variant) ?? probe.weapon;
  return (
    <div className="lobby-hero">
      <div className="lobby-hero-row" data-tour="probe">
        {open.length > 1 ? (
          <button type="button" className="lobby-turn prev" aria-label={l.prevProbe} disabled={fixed} onClick={() => turn(-1)}>
            <Icon name="back" />
          </button>
        ) : null}
        <Link to={`/taller?sonda=${probe.id}`} className="lobby-probe-link" aria-label={l.toWorkshop(probe.name)} data-sfx="hover">
          <span className="lobby-halo" aria-hidden="true" />
          <img key={probe.id} className={`lobby-probe from-${dir > 0 ? 'right' : 'left'}`} src={spriteDataUrl(probe.sprite, 16)} alt="" draggable={false} />
          <span className="lobby-pad" style={{ backgroundImage: `url(${padUrl})` }} aria-hidden="true" />
          <span className="lobby-probe-hint" aria-hidden="true">
            <Icon name="wrench" />
            {l.workshopHint}
          </span>
        </Link>
        {open.length > 1 ? (
          <button type="button" className="lobby-turn next" aria-label={l.nextProbe} disabled={fixed} onClick={() => turn(1)}>
            <Icon name="back" />
          </button>
        ) : null}
      </div>
      <div className="lobby-plate">
        <h2>{probe.name}</h2>
        <div className="lobby-plate-row">
          <span className="lobby-pips" role="img" aria-label={copy.hangar.level(probe.level, probe.maxLevel)}>
            {Array.from({ length: probe.maxLevel }, (_, i) => (
              <i key={i} className={i < probe.level ? 'on' : undefined} />
            ))}
          </span>
          <span className="lobby-weapon">
            <img src={spriteDataUrl(weapon.icon, 2)} alt="" />
            {weapon.name}
          </span>
          {self ? <span className={`lobby-state${self.ready || self.leader ? ' on' : ''}`}>{self.leader ? t.leads : self.ready ? t.ready : t.notReady}</span> : null}
        </div>
        {choose.error ? (
          <p className="field-error" role="alert">
            {errorText(choose.error, copy.errors)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** A teammate's pad, or a free one. The order puts two at my left and one at my right. */
function Mate({ m, k, lead, busy, probeOf, onKick, onLead }: { m: RoomMember | null; k: number; lead: boolean; busy: boolean; probeOf: (id: string) => { sprite: string; name: string }; onKick: (u: string) => void; onLead: (u: string) => void }) {
  const style = { order: k === 1 ? 2 : k === 0 ? 0 : -1 } as CSSProperties;
  if (!m) {
    return (
      <li className="lobby-mate empty" style={style}>
        <span className="lobby-mate-ghost" aria-hidden="true" />
        <span className="lobby-pad small" style={{ backgroundImage: `url(${padUrl})` }} aria-hidden="true" />
        <span className="lobby-mate-tag">
          <b>{t.waiting}</b>
        </span>
      </li>
    );
  }
  const probe = probeOf(m.probe);
  return (
    <li className={`lobby-mate${m.ready || m.leader ? ' ready' : ''}${m.connected ? '' : ' away'}`} style={style}>
      <img className="lobby-mate-probe" src={spriteDataUrl(probe.sprite, 8)} alt={t.flies(probe.name)} draggable={false} />
      <span className="lobby-pad small" style={{ backgroundImage: `url(${padUrl})` }} aria-hidden="true" />
      <span className="lobby-mate-tag">
        <span className="lobby-mate-name">
          {m.leader ? (
            <span className="lobby-crown" role="img" aria-label={t.leader}>
              <Icon name="trophy" />
            </span>
          ) : null}
          <Avatar name={m.username} avatar={m.avatar} frame={m.frame} />
          <b>{m.username}</b>
        </span>
        <small>{copy.social.level(m.level)}</small>
        <span className={`lobby-state${m.ready || m.leader ? ' on' : ''}${m.connected ? '' : ' away'}`}>{!m.connected ? t.disconnected : m.leader ? t.leads : m.ready ? t.ready : t.notReady}</span>
      </span>
      {lead ? (
        <span className="lobby-mate-actions">
          <button type="button" className="lip pill small" disabled={busy} onClick={() => onLead(m.username)}>
            {t.makeLeader}
          </button>
          <button type="button" className="lip pill small danger" disabled={busy} onClick={() => onKick(m.username)}>
            {t.kick}
          </button>
        </span>
      ) : null}
    </li>
  );
}

export function Stage({ view, room, me, mode, onMode, showModes }: { view: HangarView; room: RoomView | null; me: string; mode: Mode; onMode: (m: Mode) => void; showModes: boolean }) {
  const action = useRoomAction();
  const self = room?.members.find((m) => m.username === me) ?? null;
  const mates = room?.members.filter((m) => m.username !== me) ?? [];
  const slots = room ? Array.from({ length: room.max - 1 }, (_, k) => mates[k] ?? null) : [];
  const probeOf = (id: string) => view.probes.find((p) => p.id === id) ?? { sprite: 'probe-lumen', name: id };
  const lead = !!room && room.leader === me;
  return (
    <main className={`lobby-stage${room ? ' team' : ''}`}>
      {showModes ? <ModeTabs mode={mode} room={room} onMode={onMode} /> : null}
      <div className="lobby-floor">
        {room ? (
          <ul className="lobby-mates" role="list" aria-label={t.playersTitle}>
            {slots.map((m, k) => (
              <Mate
                key={m?.username ?? `free-${k}`}
                m={m}
                k={k}
                lead={lead}
                busy={action.isPending}
                probeOf={probeOf}
                onKick={(u) => action.mutate({ kind: 'kick', username: u })}
                onLead={(u) => action.mutate({ kind: 'lead', username: u })}
              />
            ))}
          </ul>
        ) : null}
        <Hero view={view} self={self} />
      </div>
      {action.error ? (
        <p className="field-error lobby-stage-error" role="alert">
          {errorText(action.error, copy.errors)}
        </p>
      ) : null}
    </main>
  );
}
