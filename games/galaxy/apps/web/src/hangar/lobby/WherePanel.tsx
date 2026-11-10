import type { HangarView, SectorCard } from '@galaxy/shared';
import { useChooseSector } from '../../api/runs';
import { spriteDataUrl } from '../../arena/sprites';
import { errorText } from '../../auth/useMe';
import { copy } from '../../copy/es';
import { Icon } from '../../ui/Icon';
import { Progress } from '../../workshop/parts';

// The sector (solo): the sector for the next runs, its Core and fauna, and the five to pick from. Open ones are
// chosen; closed ones say what opens them, with their bar.

/** A lobby area's title (Sector, Galaxias…), in the display font. */
export function StepHead({ children, id }: { children: string; id?: string }) {
  return (
    <div className="lobby-step-head">
      <span className="lobby-step-q" id={id}>
        {children}
      </span>
    </div>
  );
}

export function WherePanel({ view }: { view: HangarView }) {
  const choose = useChooseSector();
  const sector = view.sectors.find((s) => s.id === view.sector) ?? view.sectors[0];
  if (!sector) return null;
  /** A closed sector's line: the Core to beat (named from the sector the condition is about), or the season. */
  const closedLine = (s: SectorCard) => {
    if (!s.condition) return s.season ? copy.hangar.offSeason : copy.hangar.unlockSoon;
    const from = view.sectors.find((x) => x.id === s.condition!.sector);
    return copy.hangar.sectorUnlock[s.condition.stat](s.condition.value, from?.boss.name ?? '', from?.name ?? s.condition.sector);
  };
  return (
    <section className="lobby-where" aria-labelledby="lobby-sector" data-tour="sector">
      <StepHead>{copy.lobby.where}</StepHead>
      <div className="lobby-brief">
        <img className="lobby-brief-boss" src={spriteDataUrl(sector.boss.sprite, 2)} alt="" width={72} height={72} />
        <div className="lobby-brief-text">
          <div className="lobby-brief-title">
            <h2 id="lobby-sector">{sector.name}</h2>
            {sector.season ? <span className="season-badge">{copy.hangar.seasonBadge}</span> : null}
          </div>
          <small>{sector.boss.title}</small>
          <b>{sector.boss.name}</b>
        </div>
      </div>
      <p className="lobby-brief-desc">{sector.description}</p>
      <div className="lobby-fauna-row">
        <ul className="lobby-fauna" aria-label={copy.hangar.fauna}>
          {sector.fauna.map((f) => (
            <li key={f.id} title={f.name}>
              <img src={spriteDataUrl(f.sprite, 2)} alt={f.name} />
            </li>
          ))}
        </ul>
        <small>{copy.hangar.layers(Math.round(sector.layerSeconds / 60))}</small>
      </div>
      <ul className="lobby-sectors" aria-label={copy.hangar.sectorPicker}>
        {view.sectors.map((s) => {
          const chosen = s.id === sector.id;
          const art = <img className="lobby-sector-art" src={spriteDataUrl(s.boss.sprite, 1)} alt="" width={40} height={40} />;
          return (
            <li key={s.id}>
              {s.unlocked ? (
                <button
                  type="button"
                  className={`lobby-sector${chosen ? ' chosen' : ''}`}
                  aria-label={s.name}
                  aria-pressed={chosen}
                  aria-busy={(choose.isPending && choose.variables === s.id) || undefined}
                  onClick={() => {
                    if (!chosen && !choose.isPending) choose.mutate(s.id);
                  }}
                >
                  {art}
                  <span className="lobby-sector-text">
                    <b>{s.name}</b>
                    <small className={s.season && !chosen ? 'season' : undefined}>
                      {chosen ? copy.hangar.sectorChosen : s.season ? copy.hangar.seasonBadge : copy.hangar.species(s.fauna.length)}
                    </small>
                  </span>
                  {chosen ? <Icon name="check" className="ico lobby-sector-check" /> : null}
                </button>
              ) : (
                <div className="lobby-sector locked">
                  <span className="lobby-sector-lock">
                    {art}
                    <Icon name="lock" />
                  </span>
                  <span className="lobby-sector-text">
                    <b>{s.name}</b>
                    {s.condition ? <Progress name={s.name} text={closedLine(s)} value={s.condition.value} progress={s.progress} /> : <small>{closedLine(s)}</small>}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {choose.error ? (
        <p className="field-error" role="alert">
          {errorText(choose.error, copy.errors)}
        </p>
      ) : null}
    </section>
  );
}
