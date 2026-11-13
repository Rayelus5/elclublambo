import { FUSION_TOP, TIERS, type Tier } from '@galaxy/shared';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';

// The fusion tray (GDD §8.5): how many are chosen of how many, what tier they become, what it costs and whether the
// player has that much dust — all visible before anything is asked of the server.
export function FuseBar({
  selected,
  tier,
  recipe,
  dust,
  pending,
  error,
  onFuse,
  onCancel,
}: {
  selected: number;
  tier: Tier | undefined;
  recipe: { count: number; dust: number[] } | undefined;
  dust: number | undefined;
  pending: boolean;
  error: unknown;
  onFuse: () => void;
  onCancel: () => void;
}) {
  const count = recipe?.count ?? 5;
  const index = tier ? TIERS.indexOf(tier) : -1;
  const cost = index >= 0 ? recipe?.dust[index] : undefined;
  const complete = selected === count && cost !== undefined;
  const short = complete && dust !== undefined && dust < cost;
  return (
    <section className="lip panel fuse-bar" aria-label={copy.collection.fuse}>
      <div className="fuse-progress">
        <Icon name="fuse" />
        <b>{copy.collection.fuseProgress(selected, count)}</b>
        <span>{tier && index < FUSION_TOP ? copy.collection.fuseResult(copy.tiers[tier], copy.tiers[TIERS[index + 1]!]) : copy.collection.fuseHelp(count)}</span>
      </div>
      <div className="fuse-cost">
        {cost !== undefined ? <span className={short ? 'short' : undefined}>{copy.collection.fuseCost(cost)}</span> : null}
        {short ? <span className="short">{copy.collection.notEnoughDust}</span> : null}
      </div>
      {error ? (
        <p className="summary error" role="alert">
          <Icon name="alert" />
          <span>{errorText(error, copy.errors)}</span>
        </p>
      ) : null}
      <div className="fuse-actions">
        <button type="button" className="lip pill" onClick={onCancel}>
          {copy.collection.cancel}
        </button>
        <button type="button" className="lip pill pill-solar" disabled={!complete || short || pending} aria-busy={pending || undefined} onClick={onFuse}>
          {copy.collection.fuseConfirm}
        </button>
      </div>
    </section>
  );
}
