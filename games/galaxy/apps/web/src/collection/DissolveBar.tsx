import { DISINTEGRATE_MAX, type GalaxySummary, TIERS } from '@galaxy/shared';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';

// The «Desintegrar varias» tray (the owner: by selection, as when fusing): how many are chosen of the most one go
// takes, how many of each rarity, and the button. The dust is asked of the server when confirming (the lab's
// Reciclaje and the relics' refunds count), so it is never guessed here.
export function DissolveBar({
  selected,
  pending,
  error,
  onDissolve,
  onCancel,
}: {
  selected: readonly GalaxySummary[];
  pending: boolean;
  error: unknown;
  onDissolve: () => void;
  onCancel: () => void;
}) {
  const byTier = TIERS.map((t) => ({ tier: t, n: selected.filter((g) => g.tier === t).length })).filter((x) => x.n > 0);
  return (
    <section className="lip panel fuse-bar dissolve-bar" aria-label={copy.collection.dissolveMany}>
      <div className="fuse-progress">
        <Icon name="dust" />
        <b>{copy.collection.fuseProgress(selected.length, DISINTEGRATE_MAX)}</b>
        {byTier.length > 0 ? (
          <span className="dissolve-tiers">
            {byTier.map((x) => (
              <span key={x.tier} className="dissolve-tier" data-tier={x.tier}>
                {copy.tiers[x.tier]} <b>{x.n}</b>
              </span>
            ))}
          </span>
        ) : (
          <span>{copy.collection.dissolveNone}</span>
        )}
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
        <button type="button" className="lip pill danger" disabled={selected.length === 0 || pending} aria-busy={pending || undefined} onClick={onDissolve}>
          {copy.collection.disintegrate}
        </button>
      </div>
    </section>
  );
}
