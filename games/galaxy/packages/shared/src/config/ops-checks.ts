import { generateGalaxy } from '../gacha/generate';
import { eventWarnings, type EventWarning } from '../progress/events-admin';
import type { ConfigValue } from './registry';

// What makes the live config not hold together across keys (docs/CONTENIDO.md B), beyond what each key's schema checks.
// The CLI's check-config runs it over what is live on PRE plus a folder's drafts before anything is published, and
// packages/shared/test/launch-config.test.ts over every folder in ops/. Only what still runs at `now` counts: events
// and scanners that ended are history. Each problem is one Spanish line the owner can read as it is.

export interface OpsConfigs {
  season: ConfigValue<'season'>;
  events: ConfigValue<'events'>;
  gacha: ConfigValue<'gacha'>;
  missions: ConfigValue<'missions'>;
  content: ConfigValue<'content'>;
}

const WARNING_TEXT: { [C in EventWarning['code']]: (w: Extract<EventWarning, { code: C }>) => string } = {
  signals_without_scanner: (w) => `El evento ${w.event} paga señales de evento y no tiene escáner`,
  scanner_without_signals: (w) => `El escáner del evento ${w.event} existe pero ninguna meta paga sus señales`,
  scanner_dates: (w) => `El escáner del evento ${w.event} no tiene exactamente sus mismas fechas`,
  scanner_without_event: (w) => `El escáner ${w.banner} se paga con señales de un evento que no está en la lista`,
};

/** Seeds tried for a featured trait: a value no legendary can have fails on every one (the pull would fail too). */
const FEATURED_SEEDS = [7919n, 15838n, 23757n];

export function opsProblems(c: OpsConfigs, now: number): string[] {
  const out: string[] = [];
  const running = c.events.list.filter((e) => Date.parse(e.endsAt) > now);
  const open = c.gacha.banners.filter((b) => !b.endsAt || Date.parse(b.endsAt) > now);
  for (const w of eventWarnings(running, open)) out.push((WARNING_TEXT[w.code] as (x: EventWarning) => string)(w));
  for (const e of running) {
    if (Date.parse(e.startsAt) < Date.parse(c.season.startsAt) || Date.parse(e.endsAt) > Date.parse(c.season.endsAt)) {
      out.push(`El evento ${e.id} no cabe en la temporada ${c.season.id}`);
    }
  }
  for (const b of open) {
    if (!b.featured) continue;
    const { trait, value } = b.featured;
    try {
      for (const seed of FEATURED_SEEDS) generateGalaxy(seed, 4, b.featured);
    } catch {
      out.push(`La destacada ${trait}=${value} del escáner ${b.id} no puede salir legendaria`);
    }
  }
  if (!c.gacha.banners.some((b) => b.id === 'deep-scan')) out.push('Falta el escáner profundo (deep-scan)');
  const seen = new Set<string>();
  for (const m of [...c.missions.daily.pool, ...c.missions.weekly.pool, ...c.missions.season]) {
    if (seen.has(m.id)) out.push(`El id de misión ${m.id} está repetido`);
    seen.add(m.id);
  }
  if (c.season.anomaly && !c.content.anomalies.some((a) => a.id === c.season.anomaly)) out.push(`La anomalía ${c.season.anomaly} no existe en el contenido`);
  return out;
}
