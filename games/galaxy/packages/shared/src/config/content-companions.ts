import type { Content, ContentWarning } from '@galaxy/sim';
import type { ConfigValue } from './registry';

// What a new sector or probe needs from other keys (the content editor, 2026-11-16, P7): a sector added to `content`
// is open to everyone and pays ×1 until `sectors` gives it an unlock and a pay rate; a new probe is free until `probes`
// gives it an unlock; a season sector is only played while `sectors.season` names it. Warnings, shown before publishing.

export function companionWarnings({
  content,
  live,
  sectors,
  probes,
}: {
  content: Content;
  /** What is published: only what the draft adds asks for its companions. */
  live: Content;
  sectors: ConfigValue<'sectors'>;
  probes: ConfigValue<'probes'>;
}): ContentWarning[] {
  const out: ContentWarning[] = [];
  const liveSectors = new Set(live.sectors.map((s) => s.id));
  const liveProbes = new Set(live.probes.map((p) => p.id));
  content.sectors.forEach((s, i) => {
    if (s.season) {
      if (sectors.season !== s.id) out.push({ code: 'season_sector_not_live', path: `sectors.${i}`, arg: s.name });
      return;
    }
    if (liveSectors.has(s.id)) return;
    if (!sectors.unlocks[s.id]) out.push({ code: 'sector_no_unlock', path: `sectors.${i}`, arg: s.name });
    if (sectors.pay[s.id] === undefined) out.push({ code: 'sector_no_pay', path: `sectors.${i}`, arg: s.name });
  });
  content.probes.forEach((p, i) => {
    if (!liveProbes.has(p.id) && !probes.unlocks[p.id]) out.push({ code: 'probe_no_unlock', path: `probes.${i}`, arg: p.name });
  });
  return out;
}
