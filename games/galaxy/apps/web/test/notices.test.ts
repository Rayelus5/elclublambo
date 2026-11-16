import { DEFAULT_CONTENT, type SimEvent } from '@galaxy/sim';
import { expect, test } from 'vitest';
import { createNoticeQueue, noticesFor } from '../src/arena/notices';
import { copy } from '../src/copy/es';

// Centre-screen notices in a run (2026-11-16): what happens says so in the middle of the screen — a new layer, a
// Núcleo, the beacon, a satellite and its signal, the Static — one at a time; a player can turn them off in the run's
// settings. Only my own pickups and my own Static speak.

const t = copy.arena.notices;
const boss = DEFAULT_CONTENT.bosses[0]!;

test('cada suceso de la partida tiene su aviso', () => {
  const events: SimEvent[] = [
    { t: 'layer', layer: 3 },
    { t: 'bossSpawn', boss: boss.id, layer: 3 },
    { t: 'beaconOpen', x: 0, y: 0 } as SimEvent,
    { t: 'satellite', what: 'appear', x: 0, y: 0 },
    { t: 'pickup', probe: 0, kind: 'signal', value: 1 },
    { t: 'static', probe: 0, what: 'warn' },
    { t: 'static', probe: 0, what: 'start' },
  ];
  expect(noticesFor(events, 0, DEFAULT_CONTENT).map((n) => [n.text, n.tone])).toEqual([
    [t.layer(3), 'info'],
    [t.boss(boss.name), 'danger'],
    [t.beacon, 'info'],
    [t.satellite, 'info'],
    [t.signal(1), 'reward'],
    [t.staticWarn, 'danger'],
    [t.staticStart, 'danger'],
  ]);
});

test('en grupo, solo mi señal y mi Estática', () => {
  const events: SimEvent[] = [
    { t: 'pickup', probe: 1, kind: 'signal', value: 1 },
    { t: 'static', probe: 1, what: 'warn' },
    { t: 'pickup', probe: 0, kind: 'coin', value: 1 },
  ];
  expect(noticesFor(events, 0, DEFAULT_CONTENT)).toEqual([]);
});

test('la cola enseña uno cada vez, lo que dura cada uno, y no repite el mismo seguido', () => {
  const q = createNoticeQueue(2800);
  q.push([{ text: 'a', tone: 'info' }], 0);
  q.push([{ text: 'a', tone: 'info' }, { text: 'b', tone: 'info' }], 100);
  expect(q.current(0)?.text).toBe('a');
  expect(q.current(2799)?.text).toBe('a');
  expect(q.current(2800)?.text).toBe('b');
  expect(q.current(5600)).toBeNull();
});

test('la cola no crece sin fin: si se acumulan muchos, salta a los últimos', () => {
  const q = createNoticeQueue(2800, 3);
  q.push(['1', '2', '3', '4', '5'].map((text) => ({ text, tone: 'info' as const })), 0);
  expect(q.current(0)?.text).toBe('3');
});

test('el mismo aviso puede volver más tarde (la Estática avisa otra vez si te paras de nuevo)', () => {
  const q = createNoticeQueue(2800);
  q.push([{ text: 'quieto', tone: 'danger' }], 0);
  expect(q.current(3000)).toBeNull();
  q.push([{ text: 'quieto', tone: 'danger' }], 20_000);
  expect(q.current(20_000)?.text).toBe('quieto');
});

// In-run events (2026-11-16): one comes, what it dropped, or that it was lost; the whole group hears them.
test('los eventos dicen que llegan, lo que sueltan y si se pierden', () => {
  const events: SimEvent[] = [
    { t: 'worldEvent', kind: 'wreck', what: 'appear', x: 0, y: 0 },
    { t: 'worldEvent', kind: 'wreck', what: 'done', x: 0, y: 0, coins: 18, dust: 7, components: 1 },
    { t: 'worldEvent', kind: 'capsule', what: 'done', x: 0, y: 0, coins: 8, dust: 0, components: 0 },
    { t: 'worldEvent', kind: 'bounty', what: 'fail', x: 0, y: 0 },
    { t: 'worldEvent', kind: 'bounty', what: 'end', x: 0, y: 0 },
  ];
  expect(noticesFor(events, 1, DEFAULT_CONTENT).map((n) => [n.text, n.tone])).toEqual([
    [t.event.wreck, 'info'],
    ['Nave saqueada: +18 monedas · +7 polvo · +1 componente', 'reward'],
    ['Cápsula abierta: +8 monedas', 'reward'],
    [t.eventFail.bounty, 'info'],
  ]);
});

test('un peligro avisa con el nombre de su sector y no dice nada al terminar', () => {
  const events: SimEvent[] = [
    { t: 'worldEvent', kind: 'meteors', what: 'appear', x: 0, y: 0 },
    { t: 'worldEvent', kind: 'meteors', what: 'done', x: 0, y: 0 },
    { t: 'worldEvent', kind: 'ambush', what: 'appear', x: 0, y: 0 },
  ];
  expect(noticesFor(events, 0, DEFAULT_CONTENT, 'broken-forge').map((n) => [n.text, n.tone])).toEqual([
    [t.hazard.meteors(copy.arena.events.bySector['broken-forge']!.meteors!), 'danger'],
    [t.hazard.ambush(), 'danger'],
  ]);
  expect(noticesFor(events.slice(0, 1), 0, DEFAULT_CONTENT, 'outer-nebula')[0]!.text).toBe(t.hazard.meteors(copy.arena.events.meteors.name));
});

