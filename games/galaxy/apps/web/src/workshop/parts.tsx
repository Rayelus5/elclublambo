import type { ProbeCard } from '@galaxy/shared';
import { useGacha } from '../api/economy';
import { useChooseVariant, useLevelUpProbe } from '../api/runs';
import { spriteDataUrl } from '../arena/sprites';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { weaponArtUrl } from '../hangar/weapons';
import { Icon } from '../ui/Icon';

// The pieces of a probe's management (GDD §6, M4b-1), shared by the workshop and the hangar: what earns a locked one,
// its level with the next one's cost, and its starting weapon with the variants its level opens.

/** What earns a locked tile and how far the account is: its line, a bar and the count. */
export function Progress({ name, text, value, progress }: { name: string; text: string; value: number; progress: number }) {
  // The server sends stat / value; rounding gives the stat back (1999 of 2000 stays 1999, never a full bar).
  const now = Math.min(value - 1, Math.round(progress * value));
  return (
    <>
      <small className="probe-tile-sub">{text}</small>
      <span className="probe-tile-progress">
        <span className="probe-tile-bar" role="progressbar" aria-label={name} aria-valuemin={0} aria-valuemax={value} aria-valuenow={now}>
          <i style={{ inlineSize: `${(now / value) * 100}%` }} />
        </span>
        <small className="probe-tile-count">
          {now}/{value}
        </small>
      </span>
    </>
  );
}

/** Where a locked probe stands: its condition and how far the account is (GDD §6). */
export function Unlock({ card }: { card: ProbeCard }) {
  if (!card.condition) return <small className="probe-tile-sub">{copy.hangar.unlockSoon}</small>;
  return <Progress name={card.name} text={copy.hangar.unlock[card.condition.stat](card.condition.value)} value={card.condition.value} progress={card.progress} />;
}

/** The probe's level (GDD §6, M4b-1): its pips, what it adds and the next level with its cost and what is missing. */
export function ProbeLevel({ probe, onLeveled }: { probe: ProbeCard; onLeveled?: (level: number) => void }) {
  const up = useLevelUpProbe();
  const wallet = useGacha().data?.wallet;
  const pips = Array.from({ length: probe.maxLevel }, (_, i) => i < probe.level);
  const next = probe.next;
  const short = next && wallet ? { components: Math.max(0, next.components - (wallet['components'] ?? 0)), coins: Math.max(0, next.coins - wallet.coins) } : null;
  const affordable = short !== null && short.components === 0 && short.coins === 0;
  return (
    <div className="probe-level">
      <div className="probe-level-head">
        <b>{copy.hangar.level(probe.level, probe.maxLevel)}</b>
        <span className="level-pips" aria-hidden="true">
          {pips.map((on, i) => (
            <i key={i} className={on ? 'on' : undefined} />
          ))}
        </span>
      </div>
      {probe.bonuses.length > 0 ? <p className="probe-level-bonus">{copy.hangar.bonuses(probe.bonuses)}</p> : null}
      {next ? (
        <>
          <button
            type="button"
            className="lip pill pill-solar station-upgrade"
            disabled={!affordable || up.isPending}
            aria-busy={up.isPending || undefined}
            onClick={() => up.mutate({ probe: probe.id, level: probe.level + 1 }, { onSuccess: () => onLeveled?.(probe.level + 1) })}
          >
            <Icon name="wrench" />
            <span>{copy.hangar.levelUp(probe.level + 1)}</span>
            <small>{copy.station.cost(next.components, next.coins)}</small>
          </button>
          {short && !affordable ? <p className="panel-note">{copy.station.missing(short.components, short.coins)}</p> : null}
        </>
      ) : (
        <p className="panel-note">{copy.hangar.levelMax}</p>
      )}
      {up.error ? (
        <p className="field-error" role="alert">
          {errorText(up.error, copy.errors)}
        </p>
      ) : null}
    </div>
  );
}

/** A weapon's animated scene (painted in Aseprite), or its icon if it has none. */
export function WeaponArt({ id, icon }: { id: string; icon: string }) {
  const url = weaponArtUrl(id);
  if (!url) return <img className="weapon-card-icon" src={spriteDataUrl(icon, 3)} alt="" width={36} height={36} />;
  return <span className="weapon-card-art" aria-hidden="true" data-art={id} style={{ backgroundImage: `url(${url})` }} />;
}

/** The starting weapon: the base and its variants as radio cards; a closed one says the level that opens it. */
export function WeaponPicker({ probe }: { probe: ProbeCard }) {
  const choose = useChooseVariant();
  // The choice shows at once; the server's answer confirms it (or the error puts the old one back).
  const chosen = choose.isPending ? choose.variables.variant : probe.variant;
  return (
    <fieldset className="weapon-picker">
      <legend>{copy.hangar.startingWeapon}</legend>
      <div role="radiogroup" aria-label={copy.hangar.startingWeapon} className="weapon-cards">
        {probe.variants.map((w) => (
          <label key={w.id} className={`weapon-card${w.unlocked ? '' : ' locked'}`}>
            <input
              type="radio"
              name={`weapon-${probe.id}`}
              value={w.id}
              checked={chosen === w.id}
              disabled={!w.unlocked}
              onChange={() => {
                if (w.id !== probe.variant) choose.mutate({ probe: probe.id, variant: w.id });
              }}
            />
            <WeaponArt id={w.id} icon={w.icon} />
            <span className="weapon-card-text">
              <b>{w.name}</b>
              <small>{w.unlocked ? w.description : copy.hangar.variantLocked(w.unlockAt)}</small>
            </span>
            {chosen === w.id ? <Icon name="check" className="ico weapon-card-check" /> : null}
            {!w.unlocked ? <Icon name="lock" className="ico weapon-card-check" /> : null}
          </label>
        ))}
      </div>
      {choose.error ? (
        <p className="field-error" role="alert">
          {errorText(choose.error, copy.errors)}
        </p>
      ) : null}
    </fieldset>
  );
}
